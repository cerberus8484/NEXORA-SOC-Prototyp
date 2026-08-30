'use strict';

// #3 (Follow-up): Probe-Pfade des CrowdSec-Verbindungstests — ok:true / Fehler-Kategorie.
// Die Guard-Tests (crowdsecConnection.test.js) decken not_configured / SSRF / RBAC ab,
// aber NICHT das Verhalten bei erfolgreichem bzw. scheiterndem LAPI-Login (bräuchte
// Netzwerk). Hier über den Test-Seam (router.setProbeFactory) ein Fake-Client injiziert.

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
const crowdsecRouter = require('../../src/routes/crowdsec');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');

const ADMIN_PW = 'Test1234!';
let adminToken;

async function tokenFor(role, suffix) {
  const email = `ccp-${role}-${suffix}@x.io`;
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

// Default-Client wiederherstellen — kein Seam-Leak in andere Suiten (--runInBand).
afterEach(() => { crowdsecRouter.setProbeFactory(null); });

const testConn = (token, body) =>
  request(app).post('/api/v1/crowdsec/connection/test').set('Authorization', `Bearer ${token}`).send(body);

// Externer Host: passiert den SSRF-Check (kein DNS), der injizierte Client verbindet nie.
const CONFIG = { baseUrl: 'http://crowdsec.example.com', machineId: 'm', lapiPassword: 'pw' };

describe('POST /api/v1/crowdsec/connection/test — Probe-Pfade (Seam)', () => {
  test('erfolgreicher Login → 200 { ok:true, latencyMs }; Client bekommt die effektive Verbindung; Audit ok:true', async () => {
    let seen = null;
    crowdsecRouter.setProbeFactory((cfg) => { seen = cfg; return { login: async () => ({}) }; });

    const res = await testConn(adminToken, CONFIG);

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(typeof res.body.data.latencyMs).toBe('number');
    expect(seen).toMatchObject({ baseUrl: 'http://crowdsec.example.com', machineId: 'm', password: 'pw' });

    const audit = auditService.getLog().find((e) => e.action === 'CROWDSEC_CONNECTION_TEST');
    expect(audit).toBeDefined();
    expect(audit.metadata.ok).toBe(true);
  });

  test('scheiternder Login → 200 { ok:false, reason:error, error:sichere Kategorie }; Roh-Fehler NICHT im Body; Audit ok:false', async () => {
    crowdsecRouter.setProbeFactory(() => ({
      login: async () => { throw new Error('HTTP 401 secret-lapi-pw'); },
    }));

    const res = await testConn(adminToken, CONFIG);

    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.reason).toBe('error');
    expect(typeof res.body.data.error).toBe('string');
    expect(JSON.stringify(res.body)).not.toContain('secret-lapi-pw');

    const audit = auditService.getLog().find((e) => e.action === 'CROWDSEC_CONNECTION_TEST');
    expect(audit.metadata.ok).toBe(false);
  });

  test('#2 http:// zu externem Ziel → Klartext-Warnung im Ergebnis (non-blocking)', async () => {
    crowdsecRouter.setProbeFactory(() => ({ login: async () => ({}) }));
    const res = await testConn(adminToken, CONFIG); // http://crowdsec.example.com (extern)
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);            // NICHT geblockt — nur gewarnt
    expect(res.body.data.warning).toMatch(/Klartext/);
  });

  test('#2 https bzw. internes http → keine Klartext-Warnung', async () => {
    crowdsecRouter.setProbeFactory(() => ({ login: async () => ({}) }));
    const https = await testConn(adminToken, { ...CONFIG, baseUrl: 'https://crowdsec.example.com' });
    expect(https.body.data.warning).toBeUndefined();
    const intern = await testConn(adminToken, { ...CONFIG, baseUrl: 'http://10.0.10.60' });
    expect(intern.body.data.warning).toBeUndefined();
  });
});
