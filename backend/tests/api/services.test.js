'use strict';

// GET /api/v1/services — admin-only Registry steuerbarer Infrastruktur-Dienste.
// POST /api/v1/services/wazuh-manager/arm|disarm — Scharfschalten per UI.
//
// Sichert:
//   - admin → 200 + { data: [...] } mit stabiler Shape,
//   - non-admin (analyst/viewer) → 403, unauthenticated → 401,
//   - restart.enabled spiegelt den Live-Gate-/Konfig-/Arm-Zustand (kein Restart hier),
//   - arm: korrektes Passwort → armed+Audit; falsches Passwort → 403 ohne State-Change,
//   - disarm: setzt Flag false + Audit; DB-armed schaltet Restart-Gate scharf.

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const armStore = require('../../src/services/wazuhRestartArmStore');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { WAZUH_CONNECTION_KEY, saveWazuhConnection } = require('../../src/services/wazuhConnectionSettings');

let adminToken;
let analystToken;
let viewerToken;

const original = {};
const ADMIN_PW = 'Test1234!';

async function tokenFor(role, suffix, password = 'Test1234!') {
  const email = `svc-${role}-${suffix}@x.io`;
  await authService.register({ email, password, displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();

  const suffix = `${Date.now()}-${Math.random()}`;
  adminToken   = await tokenFor('admin', suffix, ADMIN_PW);
  analystToken = await tokenFor('analyst', suffix);
  viewerToken  = await tokenFor('viewer', suffix);

  original.managerRestartEnabled = config.wazuh.managerRestartEnabled;
  original.wazuhApi = { ...config.wazuhApi };
  original.wazuhIndexer = { ...config.wazuhIndexer };

  // Sauberer Ausgangszustand: DB-Flag entschärft + Audit-Log leeren.
  await armStore.setArmed(false);
  config.wazuhApi.url = '';
  config.wazuhApi.user = '';
  config.wazuhApi.password = '';
  config.wazuhIndexer.url = '';
  config.wazuhIndexer.user = '';
  config.wazuhIndexer.password = '';
  await createSettingsRepository().set(WAZUH_CONNECTION_KEY, {});
  auditService.clearLog();
});

afterEach(async () => {
  config.wazuh.managerRestartEnabled = original.managerRestartEnabled;
  Object.assign(config.wazuhApi, original.wazuhApi);
  Object.assign(config.wazuhIndexer, original.wazuhIndexer);
  await armStore.setArmed(false);
});

const asUser = (token) => request(app).get('/api/v1/services').set('Authorization', `Bearer ${token}`);
const setWazuhApiConnection = () => saveWazuhConnection(createSettingsRepository(), {
  api: { url: 'https://10.0.10.11:55000', user: 'api-user', password: 'api-pass' },
});
const setWazuhIndexerConnection = () => saveWazuhConnection(createSettingsRepository(), {
  indexer: { url: 'https://10.0.10.12:9200', user: 'idx-user', password: 'idx-pass' },
});

describe('GET /api/v1/services', () => {
  test('admin → 200, { data:[wazuh-manager] } mit stabiler Shape', async () => {
    config.wazuh.managerRestartEnabled = true;
    await setWazuhApiConnection();

    const res = await asUser(adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    const svc = res.body.data.find((s) => s.id === 'wazuh-manager');
    expect(svc).toBeDefined();
    expect(svc.name).toBe('Wazuh Manager');
    expect(svc.category).toBe('SIEM');
    expect(svc.restart.supported).toBe(true);
    expect(svc).toHaveProperty('armed');
    expect(svc).toHaveProperty('armSource');
    expect(svc.connection).toEqual({
      configured: true,
      apiConfigured: true,
      indexerConfigured: false,
    });
  });

  test('admin + ENV-Gate an + Wazuh konfiguriert → restart.enabled=true, armSource=env', async () => {
    config.wazuh.managerRestartEnabled = true;
    await setWazuhApiConnection();

    const res = await asUser(adminToken);
    const svc = res.body.data.find((s) => s.id === 'wazuh-manager');
    expect(svc.restart.enabled).toBe(true);
    expect(svc.restart.disabledReason).toBeNull();
    expect(svc.armed).toBe(true);
    expect(svc.armSource).toBe('env');
  });

  test('admin + ENV aus + nicht scharf → restart.enabled=false, Grund "Nicht scharfgeschaltet"', async () => {
    config.wazuh.managerRestartEnabled = false;
    await setWazuhApiConnection();

    const res = await asUser(adminToken);
    const svc = res.body.data.find((s) => s.id === 'wazuh-manager');
    expect(svc.restart.enabled).toBe(false);
    expect(svc.restart.disabledReason).toBe('Nicht scharfgeschaltet');
    expect(svc.armed).toBe(false);
  });

  test('admin + Wazuh NICHT konfiguriert → restart.enabled=false, Grund nennt API-Konfiguration', async () => {
    config.wazuh.managerRestartEnabled = true;

    const res = await asUser(adminToken);
    const svc = res.body.data.find((s) => s.id === 'wazuh-manager');
    expect(svc.restart.enabled).toBe(false);
    expect(svc.restart.disabledReason).toBe('Wazuh-API nicht konfiguriert');
  });

  test('admin + per UI scharfgeschaltet (ENV aus) + Wazuh konfiguriert → enabled=true, armSource=ui', async () => {
    config.wazuh.managerRestartEnabled = false;
    await setWazuhApiConnection();
    await armStore.setArmed(true);

    const res = await asUser(adminToken);
    const svc = res.body.data.find((s) => s.id === 'wazuh-manager');
    expect(svc.restart.enabled).toBe(true);
    expect(svc.armed).toBe(true);
    expect(svc.armSource).toBe('ui');
  });

  test('admin + nur Indexer konfiguriert → Verbindung sichtbar, Restart bleibt gesperrt', async () => {
    config.wazuh.managerRestartEnabled = true;
    await setWazuhIndexerConnection();

    const res = await asUser(adminToken);
    const svc = res.body.data.find((s) => s.id === 'wazuh-manager');
    expect(svc.connection).toEqual({
      configured: true,
      apiConfigured: false,
      indexerConfigured: true,
    });
    expect(svc.restart.enabled).toBe(false);
    expect(svc.restart.disabledReason).toBe('Wazuh-API nicht konfiguriert');
  });

  test('analyst → 403', async () => {
    const res = await asUser(analystToken);
    expect(res.status).toBe(403);
  });

  test('viewer → 403', async () => {
    const res = await asUser(viewerToken);
    expect(res.status).toBe(403);
  });

  test('unauthenticated → 401', async () => {
    const res = await request(app).get('/api/v1/services');
    expect(res.status).toBe(401);
  });
});

const armReq = (token, body) =>
  request(app).post('/api/v1/services/wazuh-manager/arm').set('Authorization', `Bearer ${token}`).send(body);
const disarmReq = (token) =>
  request(app).post('/api/v1/services/wazuh-manager/disarm').set('Authorization', `Bearer ${token}`).send({});

describe('POST /api/v1/services/wazuh-manager/arm', () => {
  test('admin + korrektes Passwort → 200, armed=true, armSource=ui + Audit WAZUH_MANAGER_RESTART_ARMED', async () => {
    config.wazuh.managerRestartEnabled = false;
    const res = await armReq(adminToken, { password: ADMIN_PW });
    expect(res.status).toBe(200);
    expect(res.body.data.armed).toBe(true);
    expect(res.body.data.armSource).toBe('ui');
    expect(await armStore.isArmed()).toBe(true);

    const audit = auditService.getLog().find((e) => e.action === 'WAZUH_MANAGER_RESTART_ARMED' && e.metadata.outcome === 'armed');
    expect(audit).toBeDefined();
    // Kein Passwort im Audit.
    expect(JSON.stringify(audit.metadata)).not.toContain(ADMIN_PW);
  });

  test('admin + falsches Passwort → 403, KEINE Zustandsänderung + eigene Denied-Audit-Action', async () => {
    const res = await armReq(adminToken, { password: 'wrong-password' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid_password');
    expect(await armStore.isArmed()).toBe(false);

    // Fehlversuch nutzt die dedizierte Denied-Action (nicht ARMED) → sauberes Alerting.
    const denied = auditService.getLog().find((e) => e.action === 'WAZUH_MANAGER_RESTART_ARM_DENIED');
    expect(denied).toBeDefined();
    expect(auditService.getLog().some((e) => e.action === 'WAZUH_MANAGER_RESTART_ARMED')).toBe(false);
  });

  test('admin + fehlendes Passwort → 400', async () => {
    const res = await armReq(adminToken, {});
    expect(res.status).toBe(400);
    expect(await armStore.isArmed()).toBe(false);
  });

  test('non-admin (analyst) → 403, KEINE Zustandsänderung', async () => {
    const res = await armReq(analystToken, { password: 'Test1234!' });
    expect(res.status).toBe(403);
    expect(await armStore.isArmed()).toBe(false);
  });

  test('unauthenticated → 401', async () => {
    const res = await request(app).post('/api/v1/services/wazuh-manager/arm').send({ password: ADMIN_PW });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/services/wazuh-manager/disarm', () => {
  test('admin → 200, armed=false + Audit WAZUH_MANAGER_RESTART_DISARMED', async () => {
    await armStore.setArmed(true);
    const res = await disarmReq(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.armed).toBe(false);
    expect(await armStore.isArmed()).toBe(false);

    const audit = auditService.getLog().find((e) => e.action === 'WAZUH_MANAGER_RESTART_DISARMED');
    expect(audit).toBeDefined();
  });

  test('non-admin (viewer) → 403', async () => {
    await armStore.setArmed(true);
    const res = disarmReq(viewerToken);
    expect((await res).status).toBe(403);
    // Zustand unverändert.
    expect(await armStore.isArmed()).toBe(true);
  });
});
