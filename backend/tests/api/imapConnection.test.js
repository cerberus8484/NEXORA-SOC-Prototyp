'use strict';

// Layer 2: IMAP-Postfach-Verbindung aus der UI verwalten (admin + Step-up + Audit).

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { IMAP_CONNECTION_KEY } = require('../../src/services/imapConnectionSettings');
const { isEncrypted } = require('../../src/config/secretsCrypto');

let adminToken, analystToken;
const ADMIN_PW = 'Test1234!';

async function tokenFor(role, suffix) {
  const email = `imap-${role}-${suffix}@x.io`;
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
  await createSettingsRepository().set(IMAP_CONNECTION_KEY, {});
  auditService.clearLog();
});

afterAll(async () => {
  await createSettingsRepository().set(IMAP_CONNECTION_KEY, {});
});

const getConn = (token) => {
  const req = request(app).get('/api/v1/imap/connection');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const putConn = (token, body) =>
  request(app).put('/api/v1/imap/connection').set('Authorization', `Bearer ${token}`).send(body);
const testConn = (token, body) =>
  request(app).post('/api/v1/imap/connection/test').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/imap/connection', () => {
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

describe('PUT /api/v1/imap/connection', () => {
  const VALID = { password: ADMIN_PW, host: '10.0.10.85', port: 993, user: 'soc@nexora', imapPassword: 'mbox-secret', secure: true };

  test('admin + korrektes Passwort → 200, IMAP-Passwort verschlüsselt, Audit ohne Secret', async () => {
    const res = await putConn(adminToken, VALID);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ host: '10.0.10.85', port: 993, user: 'soc@nexora', passwordSet: true, source: 'db' });
    const stored = await createSettingsRepository().get(IMAP_CONNECTION_KEY);
    expect(isEncrypted(stored.password)).toBe(true);
    const audit = auditService.getLog().find((e) => e.action === 'IMAP_CONNECTION_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('mbox-secret');
  });

  test('falsches Step-up-Passwort → 403 + Denied-Audit, nichts gespeichert', async () => {
    const res = await putConn(adminToken, { ...VALID, password: 'falsch' });
    expect(res.status).toBe(403);
    expect((await createSettingsRepository().get(IMAP_CONNECTION_KEY)).host).toBeUndefined();
    expect(auditService.getLog().some((e) => e.action === 'IMAP_CONNECTION_CHANGE_DENIED')).toBe(true);
  });

  test('Host gesetzt aber User fehlt → 400 (IMAP_INCOMPLETE)', async () => {
    const res = await putConn(adminToken, { password: ADMIN_PW, host: '10.0.10.85', user: '', imapPassword: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('IMAP_INCOMPLETE');
  });

  test.each(['169.254.169.254', '127.0.0.1', 'localhost'])('SSRF-Host %s → 400 (BLOCKED_URL)', async (host) => {
    const res = await putConn(adminToken, { password: ADMIN_PW, host, user: 'u', imapPassword: 'p' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BLOCKED_URL');
  });

  test('fehlendes Step-up-Passwort → 400 (VALIDATION_ERROR)', async () => {
    expect((await putConn(adminToken, { host: '10.0.10.85', user: 'u', imapPassword: 'p' })).status).toBe(400);
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putConn(analystToken, VALID)).status).toBe(403);
    expect((await request(app).put('/api/v1/imap/connection').send(VALID)).status).toBe(401);
  });
});

describe('POST /api/v1/imap/connection/test', () => {
  test('nicht konfiguriert → 200 { ok:false, reason:not_configured }', async () => {
    const res = await testConn(adminToken, {});
    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe('not_configured');
  });
  test.each(['169.254.169.254', '127.0.0.1', 'localhost'])('SSRF-Host %s → 400', async (host) => {
    expect((await testConn(adminToken, { host })).status).toBe(400);
  });
  test('analyst → 403', async () => {
    expect((await testConn(analystToken, {})).status).toBe(403);
  });
});
