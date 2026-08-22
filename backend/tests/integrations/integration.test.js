'use strict';

const request  = require('supertest');
const app      = require('../../src/app');
const { signWebhook }        = require('../../src/integrations/hmac');
const { integrationService } = require('../../src/integrations/IntegrationService');
const { auditService }       = require('../../src/services/AuditService');
const { authService }        = require('../../src/services/AuthService');

const TEST_SECRET = 'dev-webhook-secret-change-in-production';

// Test-Hilfsfunktion: signierten Webhook-Request erstellen
function signedPost(source, body) {
  const rawBody  = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signWebhook(TEST_SECRET, timestamp, rawBody);

  return request(app)
    .post(`/api/v1/integrations/${source}/webhook`)
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', signature)
    .set('X-Webhook-Timestamp', timestamp)
    .send(body);
}

beforeEach(() => {
  integrationService._repo.clear();
  auditService.clearLog();
  // Test-Secret setzen
  process.env.WEBHOOK_SECRET_GENERIC = TEST_SECRET;
  process.env.WEBHOOK_SECRET_QRADAR  = TEST_SECRET;
  process.env.WEBHOOK_SECRET_SPLUNK  = TEST_SECRET;
});

// ── HMAC-Verifikation ──────────────────────────────────────

describe('HMAC-Verifikation', () => {
  test('fehlende Signatur-Header → 401', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/generic/webhook')
      .send({ title: 'Test' });
    expect(res.status).toBe(401);
  });

  test('falsche Signatur → 401', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await request(app)
      .post('/api/v1/integrations/generic/webhook')
      .set('X-Webhook-Signature', 'sha256=invalidsignature')
      .set('X-Webhook-Timestamp', timestamp)
      .send({ title: 'Test' });
    expect(res.status).toBe(401);
  });

  test('abgelaufener Timestamp → 401', async () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // > 5 Minuten alt
    const body         = { title: 'Test' };
    const signature    = signWebhook(TEST_SECRET, oldTimestamp, JSON.stringify(body));
    const res = await request(app)
      .post('/api/v1/integrations/generic/webhook')
      .set('X-Webhook-Signature', signature)
      .set('X-Webhook-Timestamp', oldTimestamp)
      .send(body);
    expect(res.status).toBe(401);
  });

  test('gültige Signatur → Event wird verarbeitet', async () => {
    const res = await signedPost('generic', { title: 'C2 Beacon erkannt', priority: 'high' });
    expect(res.status).toBe(202);
  });
});

// ── Bekannte / Unbekannte Quellen ──────────────────────────

describe('Quellen-Validierung', () => {
  test('bekannte Quelle (generic) → 202', async () => {
    const res = await signedPost('generic', { title: 'Test Event' });
    expect(res.status).toBe(202);
  });

  test('bekannte Quelle (qradar) → 202', async () => {
    // QRadar nutzt dedizierten Adapter — QRadar-Format mit id-Feld
    const res = await signedPost('qradar', { id: 9001, description: 'QRadar Offense', severity: 7 });
    expect(res.status).toBe(202);
  });

  test('unbekannte Quelle → 404 (vor HMAC-Check)', async () => {
    const res = await request(app)
      .post('/api/v1/integrations/unknown-system/webhook')
      .send({ title: 'Test' });
    expect(res.status).toBe(404);
  });
});

// ── Payload-Validierung ────────────────────────────────────

describe('Payload-Validierung', () => {
  test('fehlendes title → 400', async () => {
    const res = await signedPost('generic', { priority: 'high' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('leeres title → 400', async () => {
    const res = await signedPost('generic', { title: '' });
    expect(res.status).toBe(400);
  });

  test('ungültige priority → 400', async () => {
    const res = await signedPost('generic', { title: 'Test', priority: 'ultra' });
    expect(res.status).toBe(400);
  });

  test('title über 200 Zeichen → 400', async () => {
    const res = await signedPost('generic', { title: 'A'.repeat(201) });
    expect(res.status).toBe(400);
  });
});

// ── Normalisierung ─────────────────────────────────────────

describe('Event-Normalisierung', () => {
  test('normalisierte Daten werden gespeichert', async () => {
    await signedPost('generic', {
      title:      'PowerShell C2 Beacon',
      priority:   'high',
      externalId: 'OFF-009134',
      srcIp:      '192.168.243.45',
    });
    const events = await integrationService._repo.findAll();
    expect(events.length).toBe(1);
    expect(['normalized','queued','processed']).toContain(events[0].status);
    expect(events[0].normalizedData.title).toBe('PowerShell C2 Beacon');
    expect(events[0].normalizedData.priority).toBe('high');
    expect(events[0].normalizedData.srcIp).toBe('192.168.243.45');
  });

  test('fehlende optionale Felder werden auf Defaults gesetzt', async () => {
    await signedPost('generic', { title: 'Minimal Event' });
    const events = await integrationService._repo.findAll();
    expect(events[0].normalizedData.priority).toBe('medium');
    expect(events[0].normalizedData.externalId).toBe('');
    expect(events[0].normalizedData.srcIp).toBe('');
  });

  test('eventId wird in Response zurückgegeben', async () => {
    const res = await signedPost('generic', { title: 'Test' });
    expect(res.body.eventId).toBeDefined();
    expect(res.body.status).toBe('accepted');
  });
});

// ── Deduplication ──────────────────────────────────────────

describe('Deduplication', () => {
  test('gleiches Event zweimal → 200 + status duplicate', async () => {
    const payload = { title: 'Dup Event', externalId: 'EXT-001' };
    const res1    = await signedPost('generic', payload);
    const res2    = await signedPost('generic', payload);
    expect(res1.status).toBe(202);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('duplicate');
  });
});

// ── Audit-Events ───────────────────────────────────────────

describe('Audit-Events (Datenminimierung)', () => {
  // Pipeline-Lebenszyklus (accepted/processed/queued/duplicate) ist Betriebs-
  // Telemetrie → NICHT mehr im audit_log (nur stdout-Log), Art. 5(1)(c).
  test('akzeptiertes Event schreibt KEIN INTEGRATION_ACCEPTED ins Audit', async () => {
    await signedPost('generic', { title: 'Audit Test' });
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'INTEGRATION_ACCEPTED')).toBe(false);
  });

  test('Duplikat schreibt KEIN INTEGRATION_DUPLICATE ins Audit', async () => {
    const payload = { title: 'Dup', externalId: 'EXT-DUP' };
    await signedPost('generic', payload);
    await signedPost('generic', payload);
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'INTEGRATION_DUPLICATE')).toBe(false);
  });

  // Sicherheits-/betriebsrelevant bleibt im Audit.
  test('abgelehntes Event schreibt INTEGRATION_REJECTED', async () => {
    await signedPost('generic', { title: '' }); // ungültiger Payload
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'INTEGRATION_REJECTED')).toBe(true);
  });
});

// ── GET /integrations/sources ──────────────────────────────

describe('GET /api/v1/integrations/sources', () => {
  let token;
  beforeAll(async () => {
    const email = `int-sources-${Date.now()}@test.soc`;
    await authService.register({ email, password: 'Test1234!', displayName: 'Int', role: 'analyst' });
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
    token = res.body.token;
  });

  test('ohne Token → 401', async () => {
    const res = await request(app).get('/api/v1/integrations/sources');
    expect(res.status).toBe(401);
  });

  test('gibt bekannte Quellen zurück', async () => {
    const res = await request(app).get('/api/v1/integrations/sources').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sources).toContain('generic');
    expect(res.body.sources).toContain('qradar');
    expect(res.body.sources).toContain('splunk');
  });
});
