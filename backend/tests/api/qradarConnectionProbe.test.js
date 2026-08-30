'use strict';

// #3 (Follow-up): Probe-Pfade des QRadar-Verbindungstests — ok:true / Fehler-Kategorie.
// Die bestehenden Guard-Tests (qradarConnection.test.js) decken not_configured / https /
// SSRF / RBAC / Audit ab, aber NICHT das Verhalten bei erfolgreichem bzw. scheiterndem
// Probe (der echte Provider bräuchte Netzwerk). Hier wird über den Test-Seam
// (router.setProbeFactory) ein Fake-Probe injiziert → deterministisch, ohne Netzwerk.

// Der SSRF-Guard löst DNS auf und blockt nicht auflösbare Namen vorsorglich
// (fail-closed) — dadurch scheiterten diese Tests am Testhost, der bewusst nicht
// existiert. Für DIESE Suite, die die Probe-Pfade prüft und nicht den Guard, wird
// er stillgelegt: so läuft sie wie im Kopf beschrieben "deterministisch, ohne
// Netzwerk". Die Guard-Logik selbst deckt die zugehörige *Connection.test.js ab.
jest.mock('../../src/integrations/http/internalUrlAllowlist', () => ({
  ...jest.requireActual('../../src/integrations/http/internalUrlAllowlist'),
  isBlockedSsrfUrlResolved: async () => false,
  ssrfBlockReason: async () => null,
}));

const request = require('supertest');
const app = require('../../src/app');
const qradarRouter = require('../../src/routes/qradar');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');

const ADMIN_PW = 'Test1234!';
let adminToken;

async function tokenFor(role, suffix) {
  const email = `qcp-${role}-${suffix}@x.io`;
  await authService.register({ email, password: ADMIN_PW, displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: ADMIN_PW });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  adminToken = await tokenFor('admin', `${Date.now()}-${Math.random()}`);
  auditService.clearLog();
});

// Default-Probe wiederherstellen — kein Seam-Leak in andere Suiten (--runInBand).
afterEach(() => { qradarRouter.setProbeFactory(null); });

const testConn = (token, body) =>
  request(app).post('/api/v1/qradar/connection/test').set('Authorization', `Bearer ${token}`).send(body);

// Externer Host: passiert https- + SSRF-Check (kein DNS), der injizierte Probe verbindet nie.
const CONFIG = { baseUrl: 'https://qradar.example.com', token: 't' };

describe('POST /api/v1/qradar/connection/test — Probe-Pfade (Seam)', () => {
  test('erfolgreicher Probe → 200 { ok:true, latencyMs }; Probe bekommt die effektive Verbindung; Audit ok:true', async () => {
    let seen = null;
    qradarRouter.setProbeFactory((cfg) => { seen = cfg; return { ping: async () => ({}) }; });

    const res = await testConn(adminToken, CONFIG);

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(typeof res.body.data.latencyMs).toBe('number');
    expect(seen).toEqual({ baseUrl: 'https://qradar.example.com', token: 't' });

    const audit = auditService.getLog().find((e) => e.action === 'QRADAR_CONNECTION_TEST');
    expect(audit).toBeDefined();
    expect(audit.metadata.ok).toBe(true);
  });

  test('scheiternder Probe → 200 { ok:false, reason:error, error:sichere Kategorie }; Roh-Fehler NICHT im Body; Audit ok:false', async () => {
    qradarRouter.setProbeFactory(() => ({
      ping: async () => { throw new Error('ECONNREFUSED 10.9.9.9:443 leaky-token'); },
    }));

    const res = await testConn(adminToken, CONFIG);

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.reason).toBe('error');
    expect(typeof res.body.data.error).toBe('string');            // klassifizierte, sichere Meldung
    expect(JSON.stringify(res.body)).not.toContain('leaky-token'); // kein Info-Disclosure
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');

    const audit = auditService.getLog().find((e) => e.action === 'QRADAR_CONNECTION_TEST');
    expect(audit.metadata.ok).toBe(false);
  });
});
