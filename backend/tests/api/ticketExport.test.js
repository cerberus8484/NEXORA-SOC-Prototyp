'use strict';

// ── API-Tests für POST /api/v1/tickets/:id/export (Outbound-Export P12) ──────
// Deckt: Gate (503), Auth (401), Rollen, Validierung (System), Happy-Path (201)
// mit injiziertem Fake-Adapter (kein echter HTTP-Call) + Audit, sowie der
// Fehlerpfad für ein registriertes-aber-unkonfiguriertes Zielsystem (500 + Audit).

const request = require('supertest');

const ORIGINAL = process.env.EXTERNAL_TICKET_EXPORT_ENABLED;

async function loginAs(app, role) {
  const authService = require('../../src/services/AuthService').authService;
  const email = `export-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return res.body.token;
}

async function createTicket(app, token) {
  const res = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Export-Test-Ticket', priority: 'high' });
  return res.body.data.id;
}

describe('POST /tickets/:id/export — EXTERNAL_TICKET_EXPORT_ENABLED=false (default inert)', () => {
  let app, token, ticketId;

  beforeAll(async () => {
    delete process.env.EXTERNAL_TICKET_EXPORT_ENABLED;
    jest.resetModules();
    app = require('../../src/app');
    token = await loginAs(app, 'analyst');
    ticketId = await createTicket(app, token);
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.EXTERNAL_TICKET_EXPORT_ENABLED;
    else process.env.EXTERNAL_TICKET_EXPORT_ENABLED = ORIGINAL;
    jest.resetModules();
  });

  test('gibt 503 wenn Feature deaktiviert (auch für gültigen Analysten)', async () => {
    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/export`)
      .set('Authorization', `Bearer ${token}`)
      .send({ system: 'servicenow' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('external_ticket_export_disabled');
  });
});

describe('POST /tickets/:id/export — EXTERNAL_TICKET_EXPORT_ENABLED=true', () => {
  let app, auditService, externalTicketService;
  let analystToken, viewerToken, ticketId;
  let originalSnAdapter;

  // Fake-Adapter: erfüllt den ExternalTicketAdapter-Vertrag ohne echten HTTP-Call.
  const fakeServiceNow = {
    mapToExternal: () => ({ short_description: 'fake' }),
    validateExternalPayload: () => {},
    async sendTicket() {
      return { externalId: 'SN-SYS-123', externalRef: 'INC0012345', externalUrl: 'https://sn.example/incident/SN-SYS-123' };
    },
  };

  beforeAll(async () => {
    process.env.EXTERNAL_TICKET_EXPORT_ENABLED = 'true';
    jest.resetModules();
    app                   = require('../../src/app');
    auditService          = require('../../src/services/AuditService').auditService;
    externalTicketService = require('../../src/integrations/externalTicketInstance').externalTicketService;

    // ServiceNow durch Fake ersetzen (kein realer Netz-Call); OTRS bleibt real+unkonfiguriert.
    originalSnAdapter = externalTicketService._adapters.servicenow;
    externalTicketService._adapters.servicenow = fakeServiceNow;

    analystToken = await loginAs(app, 'analyst');
    viewerToken  = await loginAs(app, 'viewer');
    ticketId     = await createTicket(app, analystToken);
  });

  afterAll(() => {
    if (originalSnAdapter) externalTicketService._adapters.servicenow = originalSnAdapter;
    if (ORIGINAL === undefined) delete process.env.EXTERNAL_TICKET_EXPORT_ENABLED;
    else process.env.EXTERNAL_TICKET_EXPORT_ENABLED = ORIGINAL;
    jest.resetModules();
  });

  test('401 ohne Auth', async () => {
    const res = await request(app).post(`/api/v1/tickets/${ticketId}/export`).send({ system: 'servicenow' });
    expect(res.status).toBe(401);
  });

  test('403 für viewer (nur analyst/admin)', async () => {
    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/export`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ system: 'servicenow' });
    expect(res.status).toBe(403);
  });

  test('400 bei unbekanntem Zielsystem', async () => {
    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/export`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ system: 'jira' });
    expect(res.status).toBe(400);
  });

  test('404 wenn Ticket nicht existiert', async () => {
    const res = await request(app)
      .post('/api/v1/tickets/does-not-exist/export')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ system: 'servicenow' });
    expect(res.status).toBe(404);
  });

  test('201 exportiert Ticket nach ServiceNow + schreibt Erfolgs-Audit mit Actor', async () => {
    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/export`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ system: 'servicenow' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('exported');
    expect(res.body.data.system).toBe('servicenow');
    expect(res.body.data.externalId).toBe('SN-SYS-123');
    expect(res.body.data.externalUrl).toBe('https://sn.example/incident/SN-SYS-123');

    const audit = await auditService.findRecent({ targetType: 'ticket', targetId: ticketId, action: 'EXTERNAL_TICKET_EXPORT_SUCCESS' });
    expect(audit.data.length).toBeGreaterThanOrEqual(1);
    expect(audit.data[0].actorLabel).toContain('export-analyst');
  });

  test('500 + Fehler-Audit bei registriertem aber unkonfiguriertem System (OTRS ohne URL)', async () => {
    const res = await request(app)
      .post(`/api/v1/tickets/${ticketId}/export`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ system: 'otrs' });

    expect(res.status).toBe(500);
    const audit = await auditService.findRecent({ targetType: 'ticket', targetId: ticketId, action: 'EXTERNAL_TICKET_EXPORT_FAILED' });
    expect(audit.data.length).toBeGreaterThanOrEqual(1);
  });
});
