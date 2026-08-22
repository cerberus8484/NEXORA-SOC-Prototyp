'use strict';

// Layer 2 (Frontend-Administrierbarkeit): Wazuh-Verbindung aus der UI verwalten.
//
// GET  /api/v1/services/wazuh-connection       — maskierte Sicht (admin-only, NIE Passwörter)
// PUT  /api/v1/services/wazuh-connection       — speichern (admin + Passwort-Step-up + Audit)
// POST /api/v1/services/wazuh-connection/test  — Verbindungstest ohne Speichern (admin)
//
// Sichert:
//   - RBAC: admin-only (analyst/viewer 403, unauth 401),
//   - Step-up: falsches Passwort → 403 + Denied-Audit, KEIN State-Change,
//   - SSRF-Schutz: nur interne Hosts (localhost/RFC-1918) als Ziel-URL,
//   - Antworten enthalten NIE ein Passwort (weder gespeichert noch ENV),
//   - PUT rekonfiguriert die laufenden Singleton-Clients sofort (kein Neustart nötig).

const request = require('supertest');
const app     = require('../../src/app');
const config  = require('../../src/config');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { WAZUH_CONNECTION_KEY } = require('../../src/services/wazuhConnectionSettings');
const { wazuhApiClient }     = require('../../src/integrations/adapters/wazuh/wazuhApiInstance');
const { wazuhIndexerClient } = require('../../src/integrations/adapters/wazuh/wazuhIndexerInstance');
const { isEncrypted } = require('../../src/config/secretsCrypto');
const tester = require('../../src/services/wazuhConnectionTester');

let adminToken;
let analystToken;

const ADMIN_PW = 'Test1234!';
const original = {};

async function tokenFor(role, suffix, password = ADMIN_PW) {
  const email = `wc-${role}-${suffix}@x.io`;
  await authService.register({ email, password, displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();

  const suffix = `${Date.now()}-${Math.random()}`;
  adminToken   = await tokenFor('admin', suffix);
  analystToken = await tokenFor('analyst', suffix);

  original.wazuhApi     = { ...config.wazuhApi };
  original.wazuhIndexer = { ...config.wazuhIndexer };
  config.wazuhApi.url = 'https://10.0.0.1:55000';
  config.wazuhApi.user = 'env-user';
  config.wazuhApi.password = 'env-pass';
  config.wazuhIndexer.url = '';
  config.wazuhIndexer.user = '';
  config.wazuhIndexer.password = '';

  // Frischer Settings-Store pro Test (InMemory-Singleton zurücksetzen).
  const repo = createSettingsRepository();
  await repo.set(WAZUH_CONNECTION_KEY, {});
  auditService.clearLog();
});

afterEach(() => {
  Object.assign(config.wazuhApi, original.wazuhApi);
  Object.assign(config.wazuhIndexer, original.wazuhIndexer);
  // Singletons zurück auf ENV-Stand — kein Test-Leak in andere Suiten.
  wazuhApiClient.reconfigure(config.wazuhApi);
  wazuhIndexerClient.reconfigure(config.wazuhIndexer);
  tester._resetFactories();
});

const getConn = (token) => {
  const req = request(app).get('/api/v1/services/wazuh-connection');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const putConn = (token, body) =>
  request(app).put('/api/v1/services/wazuh-connection').set('Authorization', `Bearer ${token}`).send(body);
const testConn = (token, body) =>
  request(app).post('/api/v1/services/wazuh-connection/test').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/services/wazuh-connection', () => {
  test('admin → 200, maskierte Shape mit source, NIE ein Passwort im Body', async () => {
    const res = await getConn(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.api).toEqual({ url: 'https://10.0.0.1:55000', user: 'env-user', passwordSet: true, source: 'env' });
    expect(res.body.data.indexer).toEqual({ url: '', user: '', passwordSet: false, source: 'none' });
    expect(JSON.stringify(res.body)).not.toContain('env-pass');
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await getConn(analystToken)).status).toBe(403);
    expect((await getConn(null)).status).toBe(401);
  });
});

describe('PUT /api/v1/services/wazuh-connection', () => {
  const VALID = {
    password: ADMIN_PW,
    api: { url: 'https://10.0.10.99:55000', user: 'ui-user', password: 'ui-pass' },
  };

  test('admin + korrektes Passwort → 200, gespeichert (verschlüsselt), Clients rekonfiguriert, Audit ohne Creds', async () => {
    const apiSpy = jest.spyOn(wazuhApiClient, 'reconfigure');

    const res = await putConn(adminToken, VALID);
    expect(res.status).toBe(200);
    expect(res.body.data.api).toMatchObject({ url: 'https://10.0.10.99:55000', user: 'ui-user', passwordSet: true, source: 'db' });

    // Verschlüsselt at rest.
    const stored = await createSettingsRepository().get(WAZUH_CONNECTION_KEY);
    expect(isEncrypted(stored.api.password)).toBe(true);

    // Laufende Singletons sofort auf neuem Stand.
    expect(apiSpy).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://10.0.10.99:55000', user: 'ui-user', password: 'ui-pass' }));

    // Audit: Aktion da, aber NIE Passwörter in den Metadaten.
    const audit = auditService.getLog().find((e) => e.action === 'WAZUH_CONNECTION_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('ui-pass');
    expect(JSON.stringify(audit.metadata)).not.toContain(ADMIN_PW);
    apiSpy.mockRestore();
  });

  test('falsches Step-up-Passwort → 403 + Denied-Audit, NICHTS gespeichert', async () => {
    const res = await putConn(adminToken, { ...VALID, password: 'falsch' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid_password');

    const stored = await createSettingsRepository().get(WAZUH_CONNECTION_KEY);
    expect(stored.api).toBeUndefined();
    expect(auditService.getLog().some((e) => e.action === 'WAZUH_CONNECTION_CHANGE_DENIED')).toBe(true);
    expect(auditService.getLog().some((e) => e.action === 'WAZUH_CONNECTION_CHANGED')).toBe(false);
  });

  test('fehlendes Step-up-Passwort → 400', async () => {
    const res = await putConn(adminToken, { api: VALID.api });
    expect(res.status).toBe(400);
  });

  test('externe URL (SSRF) → 400, NICHTS gespeichert', async () => {
    const res = await putConn(adminToken, {
      password: ADMIN_PW,
      api: { url: 'https://evil.example.com:55000', user: 'u', password: 'p' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_URL');
    const stored = await createSettingsRepository().get(WAZUH_CONNECTION_KEY);
    expect(stored.api).toBeUndefined();
  });

  test('Sektion ohne Passwort (kein gespeichertes vorhanden) → 400 SECTION_INCOMPLETE', async () => {
    const res = await putConn(adminToken, {
      password: ADMIN_PW,
      api: { url: 'https://10.0.10.99:55000', user: 'u', password: '' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SECTION_INCOMPLETE');
    const stored = await createSettingsRepository().get(WAZUH_CONNECTION_KEY);
    expect(stored.api).toBeUndefined();
  });

  test('leere API-URL → Sektion gelöscht, Auflösung zurück auf ENV', async () => {
    await putConn(adminToken, VALID);
    const res = await putConn(adminToken, { password: ADMIN_PW, api: { url: '', user: '', password: '' } });
    expect(res.status).toBe(200);
    expect(res.body.data.api.source).toBe('env');
    expect(res.body.data.api.url).toBe('https://10.0.0.1:55000');
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putConn(analystToken, VALID)).status).toBe(403);
    expect((await request(app).put('/api/v1/services/wazuh-connection').send(VALID)).status).toBe(401);
  });
});

describe('POST /api/v1/services/wazuh-connection/test', () => {
  test('admin + explizite Werte → Tester bekommt genau diese Werte, 200 { ok:true, latencyMs }', async () => {
    const seen = [];
    tester._setFactory('api', (cfg) => { seen.push(cfg); return { ping: async () => ({ ok: true }) }; });

    const res = await testConn(adminToken, { target: 'api', url: 'https://10.0.10.99:55000', user: 'u', password: 'p' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(typeof res.body.data.latencyMs).toBe('number');
    expect(seen[0]).toMatchObject({ url: 'https://10.0.10.99:55000', user: 'u', password: 'p' });
  });

  test('leere Felder fallen auf die effektive Verbindung zurück (Passwort aus ENV/DB)', async () => {
    const seen = [];
    tester._setFactory('api', (cfg) => { seen.push(cfg); return { ping: async () => ({ ok: true }) }; });

    const res = await testConn(adminToken, { target: 'api', url: '', user: '', password: '' });
    expect(res.status).toBe(200);
    expect(seen[0]).toMatchObject({ url: 'https://10.0.0.1:55000', user: 'env-user', password: 'env-pass' });
  });

  test('Fehler beim Ping ist ein erwartetes Testergebnis → 200 { ok:false, error }', async () => {
    tester._setFactory('api', () => ({ ping: async () => { throw new Error('HTTP 401'); } }));
    const res = await testConn(adminToken, { target: 'api' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    // Sicherheits-Härtung: kategorisierter Fehler statt rohem "HTTP 401" (kein Info-Disclosure).
    expect(res.body.data.error).toMatch(/Authentifizierung/);
  });

  test('unbekanntes target → 400 · externe URL → 400 (SSRF-Schutz auch hier)', async () => {
    expect((await testConn(adminToken, { target: 'nope' })).status).toBe(400);
    const res = await testConn(adminToken, { target: 'api', url: 'https://evil.example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_URL');
  });

  test('erfolgreicher Test schreibt ein Audit-Event (Ziel-Host + Ergebnis, KEINE Credentials)', async () => {
    tester._setFactory('api', () => ({ ping: async () => ({ ok: true }) }));
    await testConn(adminToken, { target: 'api', url: 'https://10.0.10.99:55000', user: 'secret-user', password: 'secret-pass' });

    const audit = auditService.getLog().find((e) => e.action === 'WAZUH_CONNECTION_TEST');
    expect(audit).toBeDefined();
    expect(audit.metadata.target).toBe('api');
    expect(audit.metadata.ok).toBe(true);
    // NIE Credentials im Audit.
    expect(JSON.stringify(audit.metadata)).not.toContain('secret-pass');
    expect(JSON.stringify(audit.metadata)).not.toContain('secret-user');
  });

  test('analyst → 403', async () => {
    expect((await testConn(analystToken, { target: 'api' })).status).toBe(403);
  });
});
