'use strict';

// Layer 2: ServiceNow-Outbound-Verbindung aus der UI verwalten.
//
// GET  /api/v1/servicenow/connection       — maskiert (admin; nie Passwort)
// PUT  /api/v1/servicenow/connection       — speichern (admin + Passwort-Step-up + Audit)
// POST /api/v1/servicenow/connection/test   — Verbindungstest ohne Speichern (admin)

// Der SSRF-Guard loest DNS auf und blockt nicht aufloesbare Namen vorsorglich
// (fail-closed). Der hier verwendete Testhost existiert bewusst nicht -- damit
// haengt das Ergebnis am Resolver des Ausfuehrenden statt am Code.
//
// Ausgenommen wird deshalb NUR dieser eine Host. Alles andere laeuft weiter
// gegen die echte Implementierung, insbesondere der SSRF-Test weiter unten mit
// 127.0.0.1 und 169.254.169.254 -- der braucht kein DNS und muss weiter blocken.
jest.mock('../../src/integrations/http/internalUrlAllowlist', () => {
  const actual = jest.requireActual('../../src/integrations/http/internalUrlAllowlist');
  const TEST_HOST = 'acme.service-now.com';
  const isTestHost = (url) => {
    try { return new URL(String(url)).hostname === TEST_HOST; } catch { return false; }
  };
  return {
    ...actual,
    isBlockedSsrfUrlResolved: async (url) => (isTestHost(url) ? false : actual.isBlockedSsrfUrlResolved(url)),
    ssrfBlockReason:          async (url) => (isTestHost(url) ? null  : actual.ssrfBlockReason(url)),
  };
});

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { SERVICENOW_CONNECTION_KEY } = require('../../src/services/servicenowConnectionSettings');
const { externalTicketService } = require('../../src/integrations/externalTicketInstance');
const { isEncrypted } = require('../../src/config/secretsCrypto');

let adminToken, analystToken;
const ADMIN_PW = 'Test1234!';
const envBackup = {};
const ENV_KEYS = ['SERVICENOW_BASE_URL', 'SERVICENOW_USERNAME', 'SERVICENOW_PASSWORD', 'SERVICENOW_TABLE'];

async function tokenFor(role, suffix) {
  const email = `sn-${role}-${suffix}@x.io`;
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
  for (const k of ENV_KEYS) { envBackup[k] = process.env[k]; delete process.env[k]; }
  await createSettingsRepository().set(SERVICENOW_CONNECTION_KEY, {});
  auditService.clearLog();
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (envBackup[k] === undefined) delete process.env[k]; else process.env[k] = envBackup[k]; }
  externalTicketService.reconfigureAdapter('servicenow', { baseUrl: '', username: '', password: '' });
});

afterAll(async () => {
  await createSettingsRepository().set(SERVICENOW_CONNECTION_KEY, {});
  externalTicketService.reconfigureAdapter('servicenow', { baseUrl: '', username: '', password: '' });
});

const getConn  = (token) => { const r = request(app).get('/api/v1/servicenow/connection'); return token ? r.set('Authorization', `Bearer ${token}`) : r; };
const putConn  = (token, body) => request(app).put('/api/v1/servicenow/connection').set('Authorization', `Bearer ${token}`).send(body);
const testConn = (token, body) => request(app).post('/api/v1/servicenow/connection/test').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/servicenow/connection', () => {
  test('admin → 200, maskiert (passwordSet + source), nie Passwort', async () => {
    const res = await getConn(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('passwordSet');
    expect(res.body.data).toHaveProperty('source');
    expect(res.body.data).not.toHaveProperty('password');
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await getConn(analystToken)).status).toBe(403);
    expect((await getConn(null)).status).toBe(401);
  });
});

describe('PUT /api/v1/servicenow/connection', () => {
  const VALID = { password: ADMIN_PW, baseUrl: 'https://acme.service-now.com', username: 'soc', servicenowPassword: 'sn-pass' };

  test('admin + korrektes Passwort → 200, Passwort verschlüsselt, Adapter rekonfiguriert, Audit ohne Passwort', async () => {
    const spy = jest.spyOn(externalTicketService, 'reconfigureAdapter');
    const res = await putConn(adminToken, VALID);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ baseUrl: 'https://acme.service-now.com', username: 'soc', table: 'incident', passwordSet: true, source: 'db' });

    const stored = await createSettingsRepository().get(SERVICENOW_CONNECTION_KEY);
    expect(isEncrypted(stored.password)).toBe(true);
    expect(spy).toHaveBeenCalledWith('servicenow', expect.objectContaining({ baseUrl: 'https://acme.service-now.com', username: 'soc', password: 'sn-pass' }));

    const audit = auditService.getLog().find((e) => e.action === 'SERVICENOW_CONNECTION_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('sn-pass');
    spy.mockRestore();
  });

  test('falsches Step-up-Passwort → 403 + Denied-Audit, nichts gespeichert', async () => {
    const res = await putConn(adminToken, { ...VALID, password: 'falsch' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid_password');
    const stored = await createSettingsRepository().get(SERVICENOW_CONNECTION_KEY);
    expect(stored.baseUrl).toBeUndefined();
    expect(auditService.getLog().some((e) => e.action === 'SERVICENOW_CONNECTION_CHANGE_DENIED')).toBe(true);
  });

  test('gesetzte URL ohne Benutzer → 400 (SERVICENOW_INCOMPLETE)', async () => {
    const res = await putConn(adminToken, { password: ADMIN_PW, baseUrl: 'https://acme.service-now.com', username: '', servicenowPassword: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SERVICENOW_INCOMPLETE');
  });

  test('fehlendes Step-up-Passwort → 400', async () => {
    expect((await putConn(adminToken, { baseUrl: 'https://acme.service-now.com', username: 'soc', servicenowPassword: 'x' })).status).toBe(400);
  });

  test('nicht-https URL → 400 (VALIDATION_ERROR)', async () => {
    const res = await putConn(adminToken, { password: ADMIN_PW, baseUrl: 'http://acme.service-now.com', username: 'soc', servicenowPassword: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putConn(analystToken, VALID)).status).toBe(403);
    expect((await request(app).put('/api/v1/servicenow/connection').send(VALID)).status).toBe(401);
  });
});

describe('POST /api/v1/servicenow/connection/test', () => {
  test('nicht konfiguriert → 200 { ok:false, reason:not_configured }', async () => {
    const res = await testConn(adminToken, {});
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.reason).toBe('not_configured');
  });

  test('nicht-https Kandidaten-URL → 400', async () => {
    expect((await testConn(adminToken, { baseUrl: 'http://evil', username: 'u', servicenowPassword: 'p' })).status).toBe(400);
  });

  test('SSRF-gesperrte Ziele (Loopback/Metadaten) → 400', async () => {
    expect((await testConn(adminToken, { baseUrl: 'https://127.0.0.1', username: 'u', servicenowPassword: 'p' })).status).toBe(400);
    const meta = await testConn(adminToken, { baseUrl: 'https://169.254.169.254', username: 'u', servicenowPassword: 'p' });
    expect(meta.status).toBe(400);
    expect(meta.body.error).toBe('BLOCKED_URL');
  });

  test('Test schreibt ein Audit-Event (Host + Ergebnis, NIE Passwort)', async () => {
    await testConn(adminToken, { baseUrl: 'https://10.0.10.60', username: 'soc', servicenowPassword: 'secret-pw' });
    const audit = auditService.getLog().find((e) => e.action === 'SERVICENOW_CONNECTION_TEST');
    expect(audit).toBeDefined();
    expect(audit.metadata.host).toBe('10.0.10.60');
    expect(JSON.stringify(audit.metadata)).not.toContain('secret-pw');
  }, 10000);

  test('analyst → 403', async () => {
    expect((await testConn(analystToken, {})).status).toBe(403);
  });
});
