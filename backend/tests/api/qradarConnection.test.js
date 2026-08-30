'use strict';

// Layer 2: QRadar-Verbindung aus der UI verwalten.
//
// GET  /api/v1/qradar/connection       — maskiert (admin; nie Token)
// PUT  /api/v1/qradar/connection       — speichern (admin + Passwort-Step-up + Audit)
// POST /api/v1/qradar/connection/test  — Verbindungstest ohne Speichern (admin)

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { QRADAR_CONNECTION_KEY } = require('../../src/services/qradarConnectionSettings');
const { qradarDashboardProvider } = require('../../src/integrations/adapters/qradar/QRadarDashboardProvider');
const { isEncrypted } = require('../../src/config/secretsCrypto');

let adminToken, analystToken;
const ADMIN_PW = 'Test1234!';
const envBackup = {};

async function tokenFor(role, suffix) {
  const email = `qc-${role}-${suffix}@x.io`;
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
  envBackup.url = process.env.QRADAR_BASE_URL;
  envBackup.token = process.env.QRADAR_TOKEN;
  delete process.env.QRADAR_BASE_URL;
  delete process.env.QRADAR_TOKEN;
  await createSettingsRepository().set(QRADAR_CONNECTION_KEY, {});
  auditService.clearLog();
});

afterEach(() => {
  if (envBackup.url === undefined) delete process.env.QRADAR_BASE_URL; else process.env.QRADAR_BASE_URL = envBackup.url;
  if (envBackup.token === undefined) delete process.env.QRADAR_TOKEN; else process.env.QRADAR_TOKEN = envBackup.token;
  qradarDashboardProvider.reconfigure({ baseUrl: '', token: '' });
});

// Settings-Singleton nach der Suite säubern (integration_qradar), damit spätere
// Suiten im selben --runInBand-Prozess keine geleakte Verbindung sehen.
afterAll(async () => {
  await createSettingsRepository().set(QRADAR_CONNECTION_KEY, {});
  qradarDashboardProvider.reconfigure({ baseUrl: '', token: '' });
});

const getConn = (token) => {
  const req = request(app).get('/api/v1/qradar/connection');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const putConn = (token, body) =>
  request(app).put('/api/v1/qradar/connection').set('Authorization', `Bearer ${token}`).send(body);
const testConn = (token, body) =>
  request(app).post('/api/v1/qradar/connection/test').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/qradar/connection', () => {
  test('admin → 200, maskiert (tokenSet + source), nie Token', async () => {
    const res = await getConn(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('tokenSet');
    expect(res.body.data).toHaveProperty('source');
    expect(res.body.data).not.toHaveProperty('token');
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await getConn(analystToken)).status).toBe(403);
    expect((await getConn(null)).status).toBe(401);
  });
});

describe('PUT /api/v1/qradar/connection', () => {
  const VALID = { password: ADMIN_PW, baseUrl: 'https://10.0.10.60', token: 'qradar-token' };

  test('admin + korrektes Passwort → 200, Token verschlüsselt, Provider rekonfiguriert, Audit ohne Token', async () => {
    const spy = jest.spyOn(qradarDashboardProvider, 'reconfigure');
    const res = await putConn(adminToken, VALID);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ baseUrl: 'https://10.0.10.60', tokenSet: true, source: 'db' });

    const stored = await createSettingsRepository().get(QRADAR_CONNECTION_KEY);
    expect(isEncrypted(stored.token)).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://10.0.10.60', token: 'qradar-token' }));

    const audit = auditService.getLog().find((e) => e.action === 'QRADAR_CONNECTION_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('qradar-token');
    spy.mockRestore();
  });

  test('falsches Step-up-Passwort → 403 + Denied-Audit, nichts gespeichert', async () => {
    const res = await putConn(adminToken, { ...VALID, password: 'falsch' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid_password');
    const stored = await createSettingsRepository().get(QRADAR_CONNECTION_KEY);
    expect(stored.baseUrl).toBeUndefined();
    expect(auditService.getLog().some((e) => e.action === 'QRADAR_CONNECTION_CHANGE_DENIED')).toBe(true);
  });

  test('fehlendes Passwort → 400', async () => {
    expect((await putConn(adminToken, { baseUrl: 'https://10.0.10.60', token: 't' })).status).toBe(400);
  });

  test('nicht-https URL → 400 (VALIDATION_ERROR)', async () => {
    const res = await putConn(adminToken, { password: ADMIN_PW, baseUrl: 'http://10.0.10.60', token: 't' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putConn(analystToken, VALID)).status).toBe(403);
    expect((await request(app).put('/api/v1/qradar/connection').send(VALID)).status).toBe(401);
  });
});

describe('POST /api/v1/qradar/connection/test', () => {
  test('nicht konfiguriert → 200 { ok:false, reason:not_configured }', async () => {
    const res = await testConn(adminToken, {});
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.reason).toBe('not_configured');
  });

  test('nicht-https Kandidaten-URL → 400', async () => {
    const res = await testConn(adminToken, { baseUrl: 'http://evil', token: 't' });
    expect(res.status).toBe(400);
  });

  test('SSRF-gesperrte Ziele (Loopback/Metadaten) → 400', async () => {
    expect((await testConn(adminToken, { baseUrl: 'https://127.0.0.1', token: 't' })).status).toBe(400);
    const meta = await testConn(adminToken, { baseUrl: 'https://169.254.169.254', token: 't' });
    expect(meta.status).toBe(400);
    expect(meta.body.error).toBe('BLOCKED_URL');
  });

  // Der Ziel-Host ist RFC-1918 (kein SSRF-Block), in CI aber nicht routbar → der
  // Probe-Call läuft in den 3s-Test-Timeout des Providers. Jest-Timeout großzügig
  // (10s), damit der bounded Netzwerk-Fehler den Test nicht am 5s-Default reißt.
  test('Test schreibt ein Audit-Event (Host + Ergebnis, NIE Token)', async () => {
    await testConn(adminToken, { baseUrl: 'https://10.0.10.60', token: 'secret-token' });
    const audit = auditService.getLog().find((e) => e.action === 'QRADAR_CONNECTION_TEST');
    expect(audit).toBeDefined();
    expect(audit.metadata.host).toBe('10.0.10.60');
    expect(JSON.stringify(audit.metadata)).not.toContain('secret-token');
  }, 10000);

  test('analyst → 403', async () => {
    expect((await testConn(analystToken, {})).status).toBe(403);
  });
});
