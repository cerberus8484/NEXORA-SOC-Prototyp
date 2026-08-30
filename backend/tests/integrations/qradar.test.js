'use strict';

const request  = require('supertest');
const app      = require('../../src/app');
const { signWebhook }              = require('../../src/integrations/hmac');
const { integrationService, IntegrationService } = require('../../src/integrations/IntegrationService');
const { auditService }             = require('../../src/services/AuditService');
const { QRadarProcessor }          = require('../../src/integrations/adapters/qradar/QRadarProcessor');
const { QRadarAdapter }            = require('../../src/integrations/adapters/qradar/QRadarAdapter');
const { TicketService }            = require('../../src/services/TicketService');
const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');

const TEST_SECRET = 'qradar-test-webhook-secret';

const VALID_OFFENSE = {
  id:           9134,
  description:  'Multiple Failed SSH Logins from External IP',
  offense_name: 'Brute Force: SSH',
  severity:     8,
  credibility:  7,
  relevance:    9,
  magnitude:    8,
  status:       'OPEN',
  start_time:   1748952000000,
  categories:   ['Authentication.LoginFailed', 'Reconnaissance.NetworkScan'],
  source_ips:   ['185.220.101.47'],
  dest_ips:     ['192.168.243.45'],
};

function signedPost(body) {
  const rawBody   = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWebhook(TEST_SECRET, timestamp, rawBody);
  return request(app)
    .post('/api/v1/integrations/qradar/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', signature)
    .set('X-Webhook-Timestamp', timestamp)
    .send(body);
}

beforeEach(() => {
  integrationService._repo.clear();
  auditService.clearLog();
  process.env.WEBHOOK_SECRET_QRADAR = TEST_SECRET;
});

afterEach(() => {
  delete process.env.WEBHOOK_SECRET_QRADAR;
});

// ── Webhook-Endpunkt E2E ─────────────────────────────────────
describe('POST /api/v1/integrations/qradar/webhook', () => {
  test('gültige Offense → 202 Accepted', async () => {
    const res = await signedPost(VALID_OFFENSE);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.eventId).toBeTruthy();
  });

  test('fehlende offense id → 400 ValidationError', async () => {
    const res = await signedPost({ description: 'Kein ID-Feld' });
    expect(res.status).toBe(400);
  });

  test('ungültige Signatur → 401', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await request(app)
      .post('/api/v1/integrations/qradar/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', 'sha256=invalid000')
      .set('X-Webhook-Timestamp', timestamp)
      .send(VALID_OFFENSE);
    expect(res.status).toBe(401);
  });

  test('Event landet im IntegrationRepository mit source=qradar', async () => {
    await signedPost(VALID_OFFENSE);
    const events = await integrationService._repo.findAll();
    expect(events.length).toBe(1);
    expect(events[0].source).toBe('qradar');
  });

  test('normalizedData enthält externalId + priority + srcIp', async () => {
    await signedPost(VALID_OFFENSE);
    const events = await integrationService._repo.findAll();
    const n = events[0].normalizedData;
    expect(n.externalId).toBe('qradar:offense:9134');
    expect(['high', 'critical']).toContain(n.priority);
    expect(n.srcIp).toBe('185.220.101.47');
  });
});

// ── QRadarProcessor Unit-Tests (isolierter TicketService) ─────
describe('QRadarProcessor', () => {
  const adapter = new QRadarAdapter();
  let tickets, proc;

  beforeEach(() => {
    tickets = new TicketService(new InMemoryTicketRepository());
    proc    = new QRadarProcessor(tickets);
    auditService.clearLog();
  });

  test('Offense → Ticket (state=OPEN, status=assigned, source=qradar)', async () => {
    const result = await proc.process(adapter.normalize(VALID_OFFENSE));
    expect(result.action).toBe('created');
    const ticket = await tickets.findById(result.ticketId);
    expect(ticket.source).toBe('qradar');
    expect(ticket.state).toBe('OPEN');
    expect(ticket.status).toBe('assigned');
    expect(ticket.offenseId).toBe('qradar:offense:9134');
    expect(['high', 'critical']).toContain(ticket.priority);
    expect(ticket.srcIp).toBe('185.220.101.47');
  });

  test('Dedup: gleiche Offense zweimal → UPDATE, ein Ticket, alertCount=2', async () => {
    const n = adapter.normalize(VALID_OFFENSE);
    const r1 = await proc.process(n);
    const r2 = await proc.process(n);
    expect(r1.action).toBe('created');
    expect(r2.action).toBe('updated');
    expect(r2.ticketId).toBe(r1.ticketId);
    expect((await tickets.findAll()).total).toBe(1);
    expect((await tickets.findById(r1.ticketId)).alertCount).toBe(2);
  });

  test('Dedup restart-sicher: neue Processor-Instanz findet bestehendes Ticket', async () => {
    const n = adapter.normalize(VALID_OFFENSE);
    const r1 = await proc.process(n);
    const r2 = await new QRadarProcessor(tickets).process(n);
    expect(r2.action).toBe('updated');
    expect(r2.ticketId).toBe(r1.ticketId);
  });

  test('Priority-Eskalation bei höherer Severity', async () => {
    const r1 = await proc.process(adapter.normalize({ ...VALID_OFFENSE, severity: 3, credibility: 3, relevance: 3 }));
    await proc.process(adapter.normalize({ ...VALID_OFFENSE, severity: 10, credibility: 10, relevance: 10 }));
    expect((await tickets.findById(r1.ticketId)).priority).toBe('critical');
  });

  test('Verschiedene Offense-IDs → separate Tickets', async () => {
    const r1 = await proc.process(adapter.normalize({ ...VALID_OFFENSE, id: 1001 }));
    const r2 = await proc.process(adapter.normalize({ ...VALID_OFFENSE, id: 1002 }));
    expect(r1.ticketId).not.toBe(r2.ticketId);
    expect((await tickets.findAll()).total).toBe(2);
  });

  test('Geschlossenes Ticket → neue Offense erzeugt neues Ticket (Recurrence)', async () => {
    const n = adapter.normalize(VALID_OFFENSE);
    const r1 = await proc.process(n);
    await tickets.update(r1.ticketId, { state: 'CLOSED', closeReason: 'resolved' });
    const r2 = await proc.process(n);
    expect(r2.action).toBe('created');
    expect(r2.ticketId).not.toBe(r1.ticketId);
  });

  test('Audit QRADAR_TICKET_CREATED + _UPDATED', async () => {
    const n = adapter.normalize(VALID_OFFENSE);
    await proc.process(n);
    await proc.process(n);
    const log = auditService.getLog();
    expect(log.some((e) => e.action === 'QRADAR_TICKET_CREATED')).toBe(true);
    expect(log.some((e) => e.action === 'QRADAR_TICKET_UPDATED')).toBe(true);
  });
});

// ── startWorker E2E (isoliert) ────────────────────────────────
describe('IntegrationService.startWorker — QRadar Ende-zu-Ende', () => {
  test('ingest einer Offense erzeugt mit laufendem Worker ein Ticket', async () => {
    const svc = new IntegrationService();
    const tix = new TicketService(new InMemoryTicketRepository());
    await svc.startWorker({ qradar: new QRadarProcessor(tix) });

    const res = await svc.ingest('qradar', VALID_OFFENSE, { ip: '10.0.0.1' });
    expect(res.status).toBe('accepted');

    const all = await tix.findAll();
    expect(all.total).toBe(1);
    expect(all.data[0].source).toBe('qradar');
    expect(all.data[0].offenseId).toBe('qradar:offense:9134');
  });
});
