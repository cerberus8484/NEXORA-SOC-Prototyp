'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { signWebhook } = require('../../src/integrations/hmac');

const TEST_SECRET = 'dataplane-test-webhook-secret';

function incident(id, { verdict = 'confirmed_malicious', severity = 'high', src = '45.143.200.12', dst = '198.51.100.10' } = {}) {
  return {
    incidentId: id,
    fusionKey: `${src}|${dst}@${id.slice(0, 6)}`,
    domains: ['ids', 'firewall', 'siem'],
    severity,
    verdict,
    network: { srcIp: src, dstIp: dst, dstPort: 22, protocol: 'tcp', bytesToServer: 1840 },
    entities: [{ type: 'ip', value: src, role: 'source' }],
    signatures: ['ET SCAN SSH'],
    mitre: ['T1110'],
    eventCount: 4,
    windowStart: '2026-06-25T12:00:00.000Z',
    windowEnd: '2026-06-25T12:01:00.000Z',
  };
}

function signedPost(body, { secret = TEST_SECRET, badSig = false } = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = badSig ? 'sha256=deadbeef' : signWebhook(secret, timestamp, rawBody);
  return request(app)
    .post('/api/v1/dataplane/incidents')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', signature)
    .set('X-Webhook-Timestamp', timestamp)
    .send(body);
}

beforeEach(() => { process.env.WEBHOOK_SECRET_DATAPLANE = TEST_SECRET; });
afterEach(() => {
  delete process.env.WEBHOOK_SECRET_DATAPLANE;
  delete process.env.WEBHOOK_SECRET_GENERIC;
});

describe('POST /api/v1/dataplane/incidents', () => {
  test('202 — gültiger Vorfall wird zum Ticket', async () => {
    const res = await signedPost(incident('a'.repeat(64)));
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.ticketId).toBeTruthy();
  });

  test('200 — identische incidentId ist idempotent (Duplikat)', async () => {
    const inc = incident('b'.repeat(64));
    const first = await signedPost(inc);
    expect(first.status).toBe(202);
    const second = await signedPost(inc);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('duplicate');
  });

  test('200 — späterer höherer Verdikt stuft das bestehende Ticket HOCH (escalated)', async () => {
    const id = 'e'.repeat(64);
    // Eigene IPs: testet Offense-ID-Eskalation, nicht Endpoint-Aggregation (würde sonst
    // mit den Default-IPs früherer Tests kollidieren → observed aggregiert statt 202).
    const ep = { src: '198.18.5.5', dst: '203.0.113.55' };
    const first = await signedPost(incident(id, { verdict: 'observed', severity: 'info', ...ep }));
    expect(first.status).toBe(202);
    const second = await signedPost(incident(id, { verdict: 'suspicious', severity: 'high', ...ep }));
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('escalated');
    expect(second.body.from).toBe('info');
    expect(second.body.to).toBe('high');
  });

  test('200 — niedrigerer/gleicher Verdikt ändert nichts (duplicate, kein Downgrade)', async () => {
    const id = 'f'.repeat(64);
    const first = await signedPost(incident(id, { verdict: 'suspicious', severity: 'high' }));
    expect(first.status).toBe(202);
    const second = await signedPost(incident(id, { verdict: 'observed', severity: 'info' }));
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('duplicate');
  });

  test('200 — wiederkehrendes observed-Rauschen (gleiche src→dst, andere incidentId) aggregiert statt neuer Tickets', async () => {
    // Anti-Flood (Honeypot): observed-Vorfälle desselben (Quelle→Ziel) churnen die
    // incidentId pro Fenster → ohne Aggregation N Tickets. Eindeutige IPs zur Isolation.
    const noise = { verdict: 'observed', severity: 'info', src: '198.18.7.7', dst: '203.0.113.200' };
    const first = await signedPost(incident('1'.repeat(64), noise));
    expect(first.status).toBe(202);
    expect(first.body.status).toBe('accepted');

    const second = await signedPost(incident('2'.repeat(64), noise));
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('aggregated');
    expect(second.body.ticketId).toBe(first.body.ticketId);
    expect(second.body.alertCount).toBe(2);

    const third = await signedPost(incident('9'.repeat(64), noise));
    expect(third.body.status).toBe('aggregated');
    expect(third.body.alertCount).toBe(3);
  });

  test('202 — höherer Verdikt (suspicious) wird NICHT in observed-Rauschen aggregiert (eigenes Ticket)', async () => {
    // Echte Incidents dürfen nicht stillschweigend ins Rauschen gemerged werden.
    const sus = { verdict: 'suspicious', severity: 'high', src: '198.18.8.8', dst: '203.0.113.201' };
    const a = await signedPost(incident('7'.repeat(64), sus));
    expect(a.status).toBe(202);
    const b = await signedPost(incident('8'.repeat(64), sus));
    expect(b.status).toBe(202);                 // neues Ticket, keine Aggregation
    expect(b.body.ticketId).not.toBe(a.body.ticketId);
  });

  test('401 — ungültige Signatur', async () => {
    const res = await signedPost(incident('c'.repeat(64)), { badSig: true });
    expect(res.status).toBe(401);
  });

  test('401 — GENERIC Secret ist kein Fallback für Dataplane', async () => {
    delete process.env.WEBHOOK_SECRET_DATAPLANE;
    process.env.WEBHOOK_SECRET_GENERIC = TEST_SECRET;
    const res = await signedPost(incident('0'.repeat(64)));
    expect(res.status).toBe(401);
  });

  test('400 — ungültiger FusedIncident (fehlende incidentId)', async () => {
    const bad = incident('d'.repeat(64)); delete bad.incidentId;
    const res = await signedPost(bad);
    expect(res.status).toBe(400);
  });
});
