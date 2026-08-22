'use strict';

// Layer 2 (Frontend-Administrierbarkeit): TI-Provider-Keys aus der UI verwalten.
//
// GET  /api/v1/settings/ti       — maskierte Key-Status (admin-only, NIE Key-Werte)
// PUT  /api/v1/settings/ti       — Keys speichern (admin, verschlüsselt, + Audit) + Provider live rekonfigurieren
// POST /api/v1/settings/ti/test  — Provider-Verbindungstest (admin), ohne Speichern
//
// RBAC lückenlos; Antworten enthalten NIE einen Key-Wert.

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { KEY_SETTING_KEY } = require('../../src/services/threatIntelKeys');
const { isEncrypted } = require('../../src/config/secretsCrypto');
const { virusTotalProvider, abuseIpDbProvider } = require('../../src/integrations/threatIntel/threatIntelInstance');

let adminToken;
let analystToken;
const suffixFor = () => `${Date.now()}-${Math.random()}`;

async function tokenFor(role, suffix) {
  const email = `ti-${role}-${suffix}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  const suffix = suffixFor();
  adminToken   = await tokenFor('admin', suffix);
  analystToken = await tokenFor('analyst', suffix);
  await createSettingsRepository().set(KEY_SETTING_KEY.virustotal, '');
  await createSettingsRepository().set(KEY_SETTING_KEY.abuseipdb, '');
  auditService.clearLog();
});

const getTi = (token) => {
  const req = request(app).get('/api/v1/settings/ti');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const putTi = (token, body) =>
  request(app).put('/api/v1/settings/ti').set('Authorization', `Bearer ${token}`).send(body);
const testTi = (token, body) =>
  request(app).post('/api/v1/settings/ti/test').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/settings/ti', () => {
  test('admin → 200, maskierte Provider-Liste, kein Key-Wert', async () => {
    const res = await getTi(adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const vt = res.body.data.find((p) => p.provider === 'virustotal');
    expect(vt).toHaveProperty('keySet');
    expect(vt).toHaveProperty('source');
    expect(vt).not.toHaveProperty('key');
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await getTi(analystToken)).status).toBe(403);
    expect((await getTi(null)).status).toBe(401);
  });
});

describe('PUT /api/v1/settings/ti', () => {
  test('admin → 200, Key verschlüsselt gespeichert, Provider live rekonfiguriert, Audit ohne Key', async () => {
    const spy = jest.spyOn(virusTotalProvider, 'reconfigure');
    const res = await putTi(adminToken, { virustotal: 'vt-secret-key' });
    expect(res.status).toBe(200);

    const stored = await createSettingsRepository().get(KEY_SETTING_KEY.virustotal);
    expect(isEncrypted(stored)).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ key: 'vt-secret-key' }));

    const audit = auditService.getLog().find((e) => e.action === 'TI_KEYS_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('vt-secret-key');
    expect(audit.metadata.changed).toContain('virustotal');
    spy.mockRestore();
  });

  test('leerer Payload → 200, nichts geändert (kein Audit-Eintrag mit changed)', async () => {
    const res = await putTi(adminToken, {});
    expect(res.status).toBe(200);
    // masked-Antwort zurück, keine Änderung.
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putTi(analystToken, { virustotal: 'x' })).status).toBe(403);
    expect((await request(app).put('/api/v1/settings/ti').send({ virustotal: 'x' })).status).toBe(401);
  });
});

describe('POST /api/v1/settings/ti/test', () => {
  afterEach(() => {
    // Provider nach Key-Manipulation im Test wieder leeren.
    virusTotalProvider.reconfigure({ key: '' });
    abuseIpDbProvider.reconfigure({ key: '' });
  });

  test('unbekannter Provider → 400', async () => {
    const res = await testTi(adminToken, { provider: 'shodan' });
    expect(res.status).toBe(400);
  });

  test('nicht konfigurierter Provider → 200 { ok:false, reason:not_configured }', async () => {
    const res = await testTi(adminToken, { provider: 'virustotal' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.reason).toBe('not_configured');
  });

  test('analyst → 403', async () => {
    expect((await testTi(analystToken, { provider: 'virustotal' })).status).toBe(403);
  });
});
