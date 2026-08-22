'use strict';

// Probe-Pfade des OTRS-Verbindungstests — ok:true / Fehler-Kategorie — plus die
// Klartext-Warnung (#2). Über den Test-Seam (router.setProbeFactory) wird ein
// Fake-Probe injiziert → deterministisch, ohne Netzwerk (der echte OTRSAdapter
// bräuchte einen erreichbaren OTRS/Znuny-Endpunkt).

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
const otrsRouter = require('../../src/routes/otrs');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');

const ADMIN_PW = 'Test1234!';
let adminToken;

async function tokenFor(role, suffix) {
  const email = `ocp-${role}-${suffix}@x.io`;
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
afterEach(() => { otrsRouter.setProbeFactory(null); });

const testConn = (token, body) =>
  request(app).post('/api/v1/otrs/connection/test').set('Authorization', `Bearer ${token}`).send(body);

// Externer Host: passiert http(s)- + SSRF-Check (kein DNS), der injizierte Probe verbindet nie.
const CONFIG = { baseUrl: 'https://otrs.example.com', username: 'u', otrsPassword: 'pw' };

describe('POST /api/v1/otrs/connection/test — Probe-Pfade (Seam)', () => {
  test('erfolgreicher Probe → 200 { ok:true, latencyMs }; Probe bekommt die effektive Verbindung; Audit ok:true', async () => {
    let seen = null;
    otrsRouter.setProbeFactory((cfg) => { seen = cfg; return { testConnection: async () => ({}) }; });

    const res = await testConn(adminToken, CONFIG);

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(typeof res.body.data.latencyMs).toBe('number');
    expect(seen).toMatchObject({ baseUrl: 'https://otrs.example.com', username: 'u', password: 'pw' });

    const audit = auditService.getLog().find((e) => e.action === 'OTRS_CONNECTION_TEST');
    expect(audit).toBeDefined();
    expect(audit.metadata.ok).toBe(true);
  });

  test('scheiternder Probe → 200 { ok:false, reason:error }; Roh-Fehler NICHT im Body; Audit ok:false', async () => {
    otrsRouter.setProbeFactory(() => ({
      testConnection: async () => { throw new Error('HTTP 401 leaky-otrs-pw'); },
    }));

    const res = await testConn(adminToken, CONFIG);

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.reason).toBe('error');
    expect(typeof res.body.data.error).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('leaky-otrs-pw');

    const audit = auditService.getLog().find((e) => e.action === 'OTRS_CONNECTION_TEST');
    expect(audit.metadata.ok).toBe(false);
  });

  test('#2 http:// zu externem Ziel → Klartext-Warnung im Ergebnis (non-blocking)', async () => {
    otrsRouter.setProbeFactory(() => ({ testConnection: async () => ({}) }));
    const res = await testConn(adminToken, { ...CONFIG, baseUrl: 'http://otrs.example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);            // NICHT geblockt — nur gewarnt
    expect(res.body.data.warning).toMatch(/Klartext/);
  });

  test('#2 https bzw. internes http → keine Klartext-Warnung', async () => {
    otrsRouter.setProbeFactory(() => ({ testConnection: async () => ({}) }));
    const https = await testConn(adminToken, CONFIG); // https extern
    expect(https.body.data.warning).toBeUndefined();
    const intern = await testConn(adminToken, { ...CONFIG, baseUrl: 'http://10.0.10.85' });
    expect(intern.body.data.warning).toBeUndefined();
  });
});
