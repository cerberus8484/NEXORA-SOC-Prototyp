'use strict';

// Layer 2: CrowdSec-LAPI-Verbindung aus der UI verwalten (admin + Step-up + Audit).

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { CROWDSEC_CONNECTION_KEY } = require('../../src/services/crowdsecConnectionSettings');
const { isEncrypted } = require('../../src/config/secretsCrypto');

let adminToken, analystToken;
const ADMIN_PW = 'Test1234!';

async function tokenFor(role, suffix) {
  const email = `cs-${role}-${suffix}@x.io`;
  await authService.register({ email, password: ADMIN_PW, displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: ADMIN_PW });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  const suffix = `${Date.now()}-${Math.random()}`;
  adminToken   = await tokenFor('admin', suffix);
  analystToken = await tokenFor('analyst', suffix);
  await createSettingsRepository().set(CROWDSEC_CONNECTION_KEY, {});
  auditService.clearLog();
});

afterAll(async () => {
  await createSettingsRepository().set(CROWDSEC_CONNECTION_KEY, {});
});

const getConn = (token) => {
  const req = request(app).get('/api/v1/crowdsec/connection');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const putConn = (token, body) =>
  request(app).put('/api/v1/crowdsec/connection').set('Authorization', `Bearer ${token}`).send(body);
const testConn = (token, body) =>
  request(app).post('/api/v1/crowdsec/connection/test').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/crowdsec/connection', () => {
  test('admin → 200, maskiert (passwordSet + source), nie Passwort', async () => {
    const res = await getConn(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('passwordSet');
    expect(res.body.data).not.toHaveProperty('password');
  });
  test('analyst → 403 · unauth → 401', async () => {
    expect((await getConn(analystToken)).status).toBe(403);
    expect((await getConn(null)).status).toBe(401);
  });
});

describe('PUT /api/v1/crowdsec/connection', () => {
  const VALID = { password: ADMIN_PW, baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', lapiPassword: 'lapi-secret' };

  test('admin + korrektes Passwort → 200, LAPI-Passwort verschlüsselt, Audit ohne Secret', async () => {
    const res = await putConn(adminToken, VALID);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', passwordSet: true, source: 'db' });
    const stored = await createSettingsRepository().get(CROWDSEC_CONNECTION_KEY);
    expect(isEncrypted(stored.password)).toBe(true);
    const audit = auditService.getLog().find((e) => e.action === 'CROWDSEC_CONNECTION_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('lapi-secret');
  });

  test('falsches Step-up-Passwort → 403 + Denied-Audit, nichts gespeichert', async () => {
    const res = await putConn(adminToken, { ...VALID, password: 'falsch' });
    expect(res.status).toBe(403);
    expect((await createSettingsRepository().get(CROWDSEC_CONNECTION_KEY)).baseUrl).toBeUndefined();
    expect(auditService.getLog().some((e) => e.action === 'CROWDSEC_CONNECTION_CHANGE_DENIED')).toBe(true);
  });

  test('URL gesetzt aber MachineID fehlt → 400 (CROWDSEC_INCOMPLETE)', async () => {
    const res = await putConn(adminToken, { password: ADMIN_PW, baseUrl: 'https://10.0.10.91:8080', machineId: '', lapiPassword: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CROWDSEC_INCOMPLETE');
  });

  test('Loopback-URL → 400 (SSRF-Deny-List)', async () => {
    const res = await putConn(adminToken, { password: ADMIN_PW, baseUrl: 'https://127.0.0.1:8080', machineId: 'm', lapiPassword: 'p' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BLOCKED_URL');
  });

  test('fehlendes Step-up-Passwort → 400 (VALIDATION_ERROR)', async () => {
    expect((await putConn(adminToken, { baseUrl: 'https://10.0.10.91:8080', machineId: 'm', lapiPassword: 'p' })).status).toBe(400);
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putConn(analystToken, VALID)).status).toBe(403);
    expect((await request(app).put('/api/v1/crowdsec/connection').send(VALID)).status).toBe(401);
  });
});

describe('POST /api/v1/crowdsec/connection/test', () => {
  test('nicht konfiguriert → 200 { ok:false, reason:not_configured }', async () => {
    const res = await testConn(adminToken, {});
    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('not_configured');
  });
  test('sendet gespeichertes Passwort nicht an ein abweichendes Ziel', async () => {
    await putConn(adminToken, { password: ADMIN_PW, baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', lapiPassword: 'stored-secret' });
    const res = await testConn(adminToken, { baseUrl: 'https://10.0.10.92:8080', machineId: 'nexora' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CREDENTIAL_TARGET_MISMATCH');
  });
  test('Loopback-URL → 400', async () => {
    expect((await testConn(adminToken, { baseUrl: 'http://127.0.0.1:8080' })).status).toBe(400);
  });
  test('analyst → 403', async () => {
    expect((await testConn(analystToken, {})).status).toBe(403);
  });
});
