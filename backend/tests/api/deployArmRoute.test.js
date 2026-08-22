'use strict';

// Deployment Center — Zwei-Schlüssel-Toggle über die UI (HTTP, InMemory).
// GET /deploy/preflight (Status/Checks) · POST /deploy/arm|disarm (admin + Reauth + Audit).
// Der env-Boden bleibt die Kommissionierung: ohne ihn ist Armen unmöglich (409).

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const deployArmStore = require('../../src/services/deployArmStore');
const { auditService } = require('../../src/services/AuditService');

const BASE = '/api/v1/deploy';

async function mkUser(role) {
  const email = `arm-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
  return { email, token };
}
const as = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});
async function reauth(user) {
  return (await request(app).post('/api/v1/auth/deploy-reauth')
    .set('Authorization', `Bearer ${user.token}`).send({ password: 'Test1234!' })).body.data.reauthToken;
}
function armReq(user, path, rt) {
  return request(app).post(`${BASE}/${path}`).set('Authorization', `Bearer ${user.token}`)
    .set('X-Reauth-Token', rt).send({});
}

let admin; let analyst;
const ENV0 = {};
let originalAuditWrite;
beforeAll(async () => {
  originalAuditWrite = auditService.write;
  admin = await mkUser('admin');
  analyst = await mkUser('analyst');
  for (const k of ['DEPLOY_ENABLED', 'DEPLOY_HYPERVISOR_ALLOWED_HOSTS', 'SETTINGS_ENC_KEY']) ENV0[k] = process.env[k];
});
afterAll(async () => {
  auditService.write = originalAuditWrite;
  for (const k of Object.keys(ENV0)) { if (ENV0[k] === undefined) delete process.env[k]; else process.env[k] = ENV0[k]; }
  await deployArmStore.setArmed(false);
});

function commission() {
  process.env.DEPLOY_ENABLED = 'true';
  process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS = '10.0.99.100,10.0.99.101';
  process.env.SETTINGS_ENC_KEY = 'dedicated-enc-key-32-chars-minimum-xyz';
}
function decommission() { process.env.DEPLOY_ENABLED = 'false'; }

describe('GET /deploy/preflight', () => {
  test('ohne Auth → 401', async () => {
    expect((await request(app).get(`${BASE}/preflight`)).status).toBe(401);
  });
  test('analyst → 403 (admin-only)', async () => {
    expect((await as(analyst.token).get(`${BASE}/preflight`)).status).toBe(403);
  });
  test('admin → 200, liefert state + checks', async () => {
    decommission();
    const res = await as(admin.token).get(`${BASE}/preflight`);
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('not_commissioned');
    expect(Array.isArray(res.body.data.checks)).toBe(true);
  });
});

describe('POST /deploy/arm', () => {
  test('ohne Reauth → 401', async () => {
    commission();
    expect((await as(admin.token).post(`${BASE}/arm`)).status).toBe(401);
  });

  test('analyst → 403', async () => {
    expect((await armReq(analyst, 'arm', 'x')).status).toBe(403);
  });

  test('nicht kommissioniert (env-Boden aus) → 409, NICHT scharf', async () => {
    decommission();
    const res = await armReq(admin, 'arm', await reauth(admin));
    expect(res.status).toBe(409);
    expect(await deployArmStore.isArmed()).toBe(false);
  });

  test('kommissioniert + Reauth → 200, effektiv scharf', async () => {
    commission();
    const res = await armReq(admin, 'arm', await reauth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('armed');
    expect(res.body.data.effectiveEnabled).toBe(true);
    expect(await deployArmStore.isArmed()).toBe(true);
  });

  test('Audit-Fehler → 500 und Gate bleibt fail-closed', async () => {
    commission();
    await deployArmStore.setArmed(false);
    const reauthToken = await reauth(admin);
    auditService.write = jest.fn().mockRejectedValueOnce(new Error('audit unavailable'));

    try {
      const res = await armReq(admin, 'arm', reauthToken);
      expect(res.status).toBe(500);
      expect(await deployArmStore.isArmed()).toBe(false);
    } finally {
      auditService.write = originalAuditWrite;
    }
  });
});

describe('POST /deploy/disarm', () => {
  test('entwaffnet immer (sichere Richtung) + Reauth → 200, nicht mehr scharf', async () => {
    commission();
    await armReq(admin, 'arm', await reauth(admin));
    const res = await armReq(admin, 'disarm', await reauth(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.effectiveEnabled).toBe(false);
    expect(await deployArmStore.isArmed()).toBe(false);
  });
});
