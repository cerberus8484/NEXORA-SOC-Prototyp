'use strict';

const request  = require('supertest');
const app      = require('../../src/app');
const { signWebhook }              = require('../../src/integrations/hmac');
const { integrationService, IntegrationService } = require('../../src/integrations/IntegrationService');
const { auditService }             = require('../../src/services/AuditService');
const { EmailProcessor }           = require('../../src/integrations/adapters/email/EmailProcessor');
const { EmailAdapter }             = require('../../src/integrations/adapters/email/EmailAdapter');
const { ImapPoller, isEnabled }    = require('../../src/integrations/adapters/email/imapPoller');
const { TicketService }            = require('../../src/services/TicketService');
const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');

const TEST_SECRET = 'email-test-webhook-secret';

const VALID_MAIL = {
  messageId:  '<alert-9134@gateway.nexora.example>',
  from:       'siem-alerts@nexora.example',
  to:         'soc@nexora.example',
  subject:    'CRITICAL: Possible breach detected on host 192.168.243.45',
  text:       'Multiple failed SSH logins from 185.220.101.47. Suspicious traffic to evil-domain.example.com. Urgent review required.',
  receivedAt: '2026-06-13T08:00:00.000Z',
};

function signedPost(body) {
  const rawBody   = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWebhook(TEST_SECRET, timestamp, rawBody);
  return request(app)
    .post('/api/v1/integrations/email/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', signature)
    .set('X-Webhook-Timestamp', timestamp)
    .send(body);
}

beforeEach(() => {
  integrationService._repo.clear();
  auditService.clearLog();
  process.env.WEBHOOK_SECRET_EMAIL = TEST_SECRET;
});

afterEach(() => {
  delete process.env.WEBHOOK_SECRET_EMAIL;
});

// ── Webhook-Endpunkt E2E ─────────────────────────────────────
describe('POST /api/v1/integrations/email/webhook', () => {
  test('gültige Mail → 202 Accepted', async () => {
    const res = await signedPost(VALID_MAIL);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.eventId).toBeTruthy();
  });

  test('leerer Payload (weder messageId noch subject) → 400 ValidationError', async () => {
    const res = await signedPost({ from: 'x@y.z' });
    expect(res.status).toBe(400);
  });

  test('ungültige Signatur → 401', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await request(app)
      .post('/api/v1/integrations/email/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', 'sha256=invalid000')
      .set('X-Webhook-Timestamp', timestamp)
      .send(VALID_MAIL);
    expect(res.status).toBe(401);
  });

  test('Event landet im IntegrationRepository mit source=email', async () => {
    await signedPost(VALID_MAIL);
    const events = await integrationService._repo.findAll();
    expect(events.length).toBe(1);
    expect(events[0].source).toBe('email');
  });

  test('normalizedData enthält externalId + priority + srcIp', async () => {
    await signedPost(VALID_MAIL);
    const events = await integrationService._repo.findAll();
    const n = events[0].normalizedData;
    expect(n.externalId).toBe('email:msg:<alert-9134@gateway.nexora.example>');
    expect(n.priority).toBe('critical');
    expect(n.srcIp).toBe('185.220.101.47');
  });
});

// ── EmailAdapter Unit-Tests ──────────────────────────────────
describe('EmailAdapter.normalize', () => {
  const adapter = new EmailAdapter();

  test('Subject + Body Keywords → Priority', () => {
    expect(adapter.normalize({ subject: 'breach detected' }).priority).toBe('critical');
    expect(adapter.normalize({ subject: 'login failed' }).priority).toBe('high');
    expect(adapter.normalize({ subject: 'suspicious activity' }).priority).toBe('medium');
    expect(adapter.normalize({ subject: 'informational notice' }).priority).toBe('low');
    expect(adapter.normalize({ subject: 'Daily summary' }).priority).toBe('medium'); // default
  });

  test('IOC-Extraktion (IPs + Domains) aus dem Body', () => {
    const n = adapter.normalize(VALID_MAIL);
    expect(n.iocs.ips).toContain('185.220.101.47');
    expect(n.iocs.ips).toContain('192.168.243.45');
    expect(n.iocs.domains).toContain('evil-domain.example.com');
  });

  test('messageId als externalId / Dedup-Schlüssel', () => {
    const n = adapter.normalize({ messageId: 'abc-123', subject: 'x' });
    expect(n.externalId).toBe('email:msg:abc-123');
  });

  test('Fallback-externalId aus from+subject wenn messageId fehlt', () => {
    const n = adapter.normalize({ from: 'a@b.c', subject: 'Hello' });
    expect(n.externalId).toBe('email:msg:a@b.c|Hello');
  });

  test('Titel aus Subject, gedeckelt auf 200 Zeichen', () => {
    const long = 'X'.repeat(400);
    const n = adapter.normalize({ subject: long, messageId: 'm1' });
    expect(n.title.length).toBe(200);
  });

  test('voller Body bleibt nur in Evidence, nicht in description', () => {
    const big = 'SECRET'.repeat(200);
    const n = adapter.normalize({ messageId: 'm2', subject: 'alert', text: big });
    expect(n.evidence[0].raw.text).toBe(big);
    expect(n.description.length).toBeLessThan(big.length);
  });
});

// ── EmailProcessor Unit-Tests (isolierter TicketService) ──────
describe('EmailProcessor', () => {
  const adapter = new EmailAdapter();
  let tickets, proc;

  beforeEach(() => {
    tickets = new TicketService(new InMemoryTicketRepository());
    proc    = new EmailProcessor(tickets);
    auditService.clearLog();
  });

  test('Mail → Ticket (state=OPEN, status=assigned, source=email)', async () => {
    const result = await proc.process(adapter.normalize(VALID_MAIL));
    expect(result.action).toBe('created');
    const ticket = await tickets.findById(result.ticketId);
    expect(ticket.source).toBe('email');
    expect(ticket.state).toBe('OPEN');
    expect(ticket.status).toBe('assigned');
    expect(ticket.offenseId).toBe('email:msg:<alert-9134@gateway.nexora.example>');
    expect(ticket.priority).toBe('critical');
    expect(ticket.srcIp).toBe('185.220.101.47');
  });

  test('Dedup: gleiche messageId zweimal → UPDATE, ein Ticket, alertCount=2', async () => {
    const n = adapter.normalize(VALID_MAIL);
    const r1 = await proc.process(n);
    const r2 = await proc.process(n);
    expect(r1.action).toBe('created');
    expect(r2.action).toBe('updated');
    expect(r2.ticketId).toBe(r1.ticketId);
    expect((await tickets.findAll()).total).toBe(1);
    expect((await tickets.findById(r1.ticketId)).alertCount).toBe(2);
  });

  test('Dedup restart-sicher: neue Processor-Instanz findet bestehendes Ticket', async () => {
    const n = adapter.normalize(VALID_MAIL);
    const r1 = await proc.process(n);
    const r2 = await new EmailProcessor(tickets).process(n);
    expect(r2.action).toBe('updated');
    expect(r2.ticketId).toBe(r1.ticketId);
  });

  test('Verschiedene messageIds → separate Tickets', async () => {
    const r1 = await proc.process(adapter.normalize({ ...VALID_MAIL, messageId: 'm-1' }));
    const r2 = await proc.process(adapter.normalize({ ...VALID_MAIL, messageId: 'm-2' }));
    expect(r1.ticketId).not.toBe(r2.ticketId);
    expect((await tickets.findAll()).total).toBe(2);
  });

  test('Geschlossenes Ticket → neue Mail erzeugt neues Ticket (Recurrence)', async () => {
    const n = adapter.normalize(VALID_MAIL);
    const r1 = await proc.process(n);
    await tickets.update(r1.ticketId, { state: 'CLOSED', closeReason: 'resolved' });
    const r2 = await proc.process(n);
    expect(r2.action).toBe('created');
    expect(r2.ticketId).not.toBe(r1.ticketId);
  });

  test('Audit EMAIL_TICKET_CREATED + _UPDATED', async () => {
    const n = adapter.normalize(VALID_MAIL);
    await proc.process(n);
    await proc.process(n);
    const log = auditService.getLog();
    expect(log.some((e) => e.action === 'EMAIL_TICKET_CREATED')).toBe(true);
    expect(log.some((e) => e.action === 'EMAIL_TICKET_UPDATED')).toBe(true);
  });
});

// ── EmailProcessor — Phishing-Anreicherung (parsePhishingEmail verdrahtet) ──
describe('EmailProcessor — Phishing-Parser-Anreicherung', () => {
  const adapter = new EmailAdapter();
  let tickets, proc;

  beforeEach(() => {
    tickets = new TicketService(new InMemoryTicketRepository());
    proc    = new EmailProcessor(tickets);
    auditService.clearLog();
  });

  // Gespoofte Phishing-Mail: From ≠ Return-Path, DMARC fail, defangte URL,
  // gefährlicher Anhang (Doppel-Extension).
  const PHISH_MAIL = {
    messageId:  '<phish-1@evil.example>',
    from:       'IT-Support <support@trusted-bank.example>',
    returnPath: '<bounce@evil-sender.ru>',
    subject:    'URGENT: Verify your account now',
    body:       'Please log in at hxxp://secure-login.evil.ru/verify and confirm. Ref hash d41d8cd98f00b204e9800998ecf8427e',
    headers: {
      'Authentication-Results': 'mx; spf=fail smtp.mailfrom=evil.ru; dkim=fail; dmarc=fail header.from=trusted-bank.example',
    },
    attachments: [{ name: 'invoice.pdf.exe', sha256: 'a'.repeat(64) }],
  };

  test('geparste IOCs + Phishing-Indikatoren landen im Ticket-Draft', async () => {
    const result = await proc.process(adapter.normalize(PHISH_MAIL));
    expect(result.action).toBe('created');
    const ticket = await tickets.findById(result.ticketId);

    // IOCs (defangte URL refanged, Hash) im iocs-Feld
    expect(ticket.iocs).toMatch(/secure-login\.evil\.ru/);
    expect(ticket.iocs.toLowerCase()).toContain('d41d8cd98f00b204e9800998ecf8427e');

    // Phishing-Indikatoren in der Beschreibung sichtbar
    expect(ticket.description).toMatch(/from_returnpath_mismatch|Return-Path/i);
    expect(ticket.description).toMatch(/double_extension_attachment|invoice\.pdf\.exe/i);
    expect(ticket.description).toMatch(/dmarc/i);
  });

  test('Parser-Fehler verschluckt das Ticket NICHT (fail-safe)', async () => {
    // Parser monkeypatchen, sodass er wirft — Ticket muss trotzdem entstehen.
    const phishingParser = require('../../src/integrations/adapters/email/phishingParser');
    const orig = phishingParser.parsePhishingEmail;
    phishingParser.parsePhishingEmail = () => { throw new Error('parser boom'); };
    try {
      const result = await proc.process(adapter.normalize(VALID_MAIL));
      expect(result.action).toBe('created');
      const ticket = await tickets.findById(result.ticketId);
      expect(ticket).toBeTruthy();
      expect(ticket.source).toBe('email');
    } finally {
      phishingParser.parsePhishingEmail = orig;
    }
  });

  test('Nicht-Phishing-Mail ohne Indikatoren → Ticket normal, keine erfundenen Indikatoren', async () => {
    const clean = {
      messageId: '<clean-1@nexora.example>',
      from:      'alerts@nexora.example',
      subject:   'Daily summary report',
      body:      'All systems nominal.',
    };
    const result = await proc.process(adapter.normalize(clean));
    const ticket = await tickets.findById(result.ticketId);
    expect(ticket).toBeTruthy();
    expect(ticket.description).not.toMatch(/spoofing|mismatch/i);
  });
});

// ── startWorker E2E (isoliert) ────────────────────────────────
describe('IntegrationService.startWorker — E-Mail Ende-zu-Ende', () => {
  test('ingest einer Mail erzeugt mit laufendem Worker ein Ticket', async () => {
    const svc = new IntegrationService();
    const tix = new TicketService(new InMemoryTicketRepository());
    await svc.startWorker({ email: new EmailProcessor(tix) });

    const res = await svc.ingest('email', VALID_MAIL, { ip: '10.0.0.1' });
    expect(res.status).toBe('accepted');

    const all = await tix.findAll();
    expect(all.total).toBe(1);
    expect(all.data[0].source).toBe('email');
    expect(all.data[0].offenseId).toBe('email:msg:<alert-9134@gateway.nexora.example>');
  });
});

// ── IMAP-Poller ───────────────────────────────────────────────
const IMAP_ENV = { IMAP_HOST: 'imap.nexora.example', IMAP_USER: 'soc', IMAP_PASSWORD: 'secret' };

// Minimaler ImapFlow-Mock: bildet die im Poller genutzten Methoden ab.
function makeFakeClient({ uids = [], messages = {} } = {}) {
  const calls = { seenFlagsAddedFor: [], connected: false, loggedOut: false, released: false };
  return {
    calls,
    async connect() { calls.connected = true; },
    async getMailboxLock() { return { release: () => { calls.released = true; } }; },
    async search() { return uids; },
    async fetchOne(uid) { return messages[uid] || null; },
    async messageFlagsAdd(uid) { calls.seenFlagsAddedFor.push(uid); return true; },
    async logout() { calls.loggedOut = true; },
  };
}

function envelopeMessage(messageId, subject, text) {
  return {
    envelope: {
      messageId,
      subject,
      from: [{ address: 'siem-alerts@nexora.example' }],
      to:   [{ address: 'soc@nexora.example' }],
      date: '2026-06-13T08:00:00.000Z',
    },
    source: Buffer.from(text, 'utf8'),
  };
}

describe('ImapPoller — unkonfiguriert ohne ENV', () => {
  test('Layer 2: start() startet Loop trotzdem (self-skip), kein Crash', () => {
    expect(isEnabled({})).toBe(false);
    const poller = new ImapPoller(integrationService, { env: {} });
    expect(poller.isEnabled()).toBe(false);   // ENV-Hinweis: unkonfiguriert
    expect(poller.start()).toBe(true);        // Loop läuft; pollOnce self-skippt pro Zyklus
    poller.stop();
  });
});

describe('ImapPoller — Polling mit gemocktem imapflow', () => {
  test('enabled wenn IMAP_HOST/USER/PASSWORD gesetzt', () => {
    expect(isEnabled(IMAP_ENV)).toBe(true);
    const poller = new ImapPoller(integrationService, { env: IMAP_ENV, clientFactory: () => makeFakeClient() });
    expect(poller.isEnabled()).toBe(true);
  });

  test('ungelesene Mail → ingest in die Pipeline + als \\Seen markiert', async () => {
    const svc = new IntegrationService();
    const tix = new TicketService(new InMemoryTicketRepository());
    await svc.startWorker({ email: new EmailProcessor(tix) });

    const fake = makeFakeClient({
      uids: [42],
      messages: { 42: envelopeMessage('<poll-1@nexora.example>', 'CRITICAL: breach detected', 'Failed SSH from 185.220.101.47') },
    });
    const poller = new ImapPoller(svc, { env: IMAP_ENV, clientFactory: () => fake });

    const result = await poller.pollOnce();

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(fake.calls.seenFlagsAddedFor).toEqual(['42']);
    expect(fake.calls.loggedOut).toBe(true);

    const all = await tix.findAll();
    expect(all.total).toBe(1);
    expect(all.data[0].source).toBe('email');
    expect(all.data[0].offenseId).toBe('email:msg:<poll-1@nexora.example>');
  });

  test('keine ungelesenen Mails → processed 0, kein Fehler', async () => {
    const fake   = makeFakeClient({ uids: [] });
    const poller = new ImapPoller(integrationService, { env: IMAP_ENV, clientFactory: () => fake });
    const result = await poller.pollOnce();
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(fake.calls.seenFlagsAddedFor).toEqual([]);
  });

  test('Fehler bei einer Mail → gefangen, andere Mails laufen weiter, fehlerhafte bleibt ungelesen', async () => {
    const svc = new IntegrationService();
    const tix = new TicketService(new InMemoryTicketRepository());
    await svc.startWorker({ email: new EmailProcessor(tix) });

    const fake = makeFakeClient({
      uids: [1, 2],
      messages: {
        1: null, // fetchOne liefert nichts → failed
        2: envelopeMessage('<poll-ok@nexora.example>', 'login failed', 'Body'),
      },
    });
    const poller = new ImapPoller(svc, { env: IMAP_ENV, clientFactory: () => fake });

    const result = await poller.pollOnce();

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    // Nur die erfolgreich verarbeitete Mail wird als gelesen markiert.
    expect(fake.calls.seenFlagsAddedFor).toEqual(['2']);
  });

  test('start() aktiviert den Poller (true) und stop() räumt den Timer ab', () => {
    const poller = new ImapPoller(integrationService, { env: IMAP_ENV, clientFactory: () => makeFakeClient() });
    expect(poller.start()).toBe(true);
    poller.stop();
  });
});
