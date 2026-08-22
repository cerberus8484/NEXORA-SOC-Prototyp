'use strict';

// POST /api/v1/wazuh/manager/restart (W6) — Gate + RBAC + Audit.
//
// Security-sensibel: Remote-Service-Steuerung. Tests sichern, dass
//   - das ENV-Gate (WAZUH_MANAGER_RESTART_ENABLED) per Default sperrt,
//   - nur admin durchkommt (viewer/analyst → 403),
//   - bei admin+Gate-an der Client gerufen + ein Audit-Eintrag geschrieben wird,
//   - invalide Wazuh-Config den Restart abbricht (kein Manager-Selbstmord).

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { wazuhApiClient } = require('../../src/integrations/adapters/wazuh/wazuhApiInstance');

let adminToken;
let analystToken;
let viewerToken;

// Original-Methoden/Flags sichern → nach jedem Test zurücksetzen (kein Leak).
const original = {};

async function tokenFor(role, suffix) {
  const email = `wzr-${role}-${suffix}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();

  const suffix = `${Date.now()}-${Math.random()}`;
  adminToken   = await tokenFor('admin', suffix);
  analystToken = await tokenFor('analyst', suffix);
  viewerToken  = await tokenFor('viewer', suffix);

  // Client-Stubs: enabled + steuerbares restart/validate Verhalten.
  original.managerRestartEnabled = config.wazuh.managerRestartEnabled;
  original.isEnabled = wazuhApiClient.isEnabled;
  original.restartManager = wazuhApiClient.restartManager;
  original.validateConfiguration = wazuhApiClient.validateConfiguration;

  wazuhApiClient.isEnabled = () => true;
  wazuhApiClient.restartManager = async () => { wazuhApiClient._restartCalled = true; return { restarted: true, confirmed: true }; };
  wazuhApiClient.validateConfiguration = async () => ({ ok: true, status: 'OK', details: {} });
  wazuhApiClient._restartCalled = false;
});

afterEach(() => {
  config.wazuh.managerRestartEnabled = original.managerRestartEnabled;
  wazuhApiClient.isEnabled = original.isEnabled;
  wazuhApiClient.restartManager = original.restartManager;
  wazuhApiClient.validateConfiguration = original.validateConfiguration;
  delete wazuhApiClient._restartCalled;
});

const asUser = (token) => request(app).post('/api/v1/wazuh/manager/restart').set('Authorization', `Bearer ${token}`);

describe('POST /api/v1/wazuh/manager/restart', () => {
  test('Gate aus (default) → 403 disabled, Client NICHT gerufen, kein Restart-Audit', async () => {
    config.wazuh.managerRestartEnabled = false;
    const res = await asUser(adminToken).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('disabled');
    expect(wazuhApiClient._restartCalled).toBe(false);
    expect(auditService.getLog().some((e) => e.action === 'WAZUH_MANAGER_RESTART')).toBe(false);
  });

  test('admin + Gate an → ruft Client, 200, Audit WAZUH_MANAGER_RESTART geschrieben', async () => {
    config.wazuh.managerRestartEnabled = true;
    const res = await asUser(adminToken).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(wazuhApiClient._restartCalled).toBe(true);

    const entry = auditService.getLog().find((e) => e.action === 'WAZUH_MANAGER_RESTART');
    expect(entry).toBeDefined();
    expect(entry.metadata.outcome).toBe('restarted');
  });

  test('viewer → 403 (kein Restart, egal ob Gate an)', async () => {
    config.wazuh.managerRestartEnabled = true;
    const res = await asUser(viewerToken).send({});
    expect(res.status).toBe(403);
    expect(wazuhApiClient._restartCalled).toBe(false);
  });

  test('analyst → 403 (kein Restart)', async () => {
    config.wazuh.managerRestartEnabled = true;
    const res = await asUser(analystToken).send({});
    expect(res.status).toBe(403);
    expect(wazuhApiClient._restartCalled).toBe(false);
  });

  test('unauthenticated → 401', async () => {
    config.wazuh.managerRestartEnabled = true;
    const res = await request(app).post('/api/v1/wazuh/manager/restart').send({});
    expect(res.status).toBe(401);
  });

  test('invalide Config → 422, KEIN Restart, Audit outcome=aborted_invalid_config', async () => {
    config.wazuh.managerRestartEnabled = true;
    wazuhApiClient.validateConfiguration = async () => ({ ok: false, status: 'ERROR', details: {} });
    const res = await asUser(adminToken).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_config');
    expect(wazuhApiClient._restartCalled).toBe(false);

    const entry = auditService.getLog().find((e) => e.action === 'WAZUH_MANAGER_RESTART');
    expect(entry.metadata.outcome).toBe('aborted_invalid_config');
  });

  test('Fehler beim Restart → 502, Audit outcome=failed, keine Secret-Leakage', async () => {
    config.wazuh.managerRestartEnabled = true;
    wazuhApiClient.restartManager = async () => { throw new Error('Bearer eyJsecret-token-leak'); };
    const res = await asUser(adminToken).send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('restart_failed');
    // Response darf die Roh-Fehlermeldung (mit Token) NICHT enthalten.
    expect(JSON.stringify(res.body)).not.toContain('secret-token-leak');

    const entry = auditService.getLog().find((e) => e.action === 'WAZUH_MANAGER_RESTART');
    expect(entry.metadata.outcome).toBe('failed');
  });
});
