'use strict';

// POST /api/v1/wazuh/manager/restart — Fokus: der Scharfschalt-Gate.
// Sichert, dass das DB-Arm-Flag den Gate ÖFFNET, auch wenn die ENV aus ist
// (ENV bleibt Fallback), und dass ohne Scharfschaltung 403 kommt.
// Die Restart-/Validate-/Audit-Logik selbst wird hier NICHT geändert/getestet.

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');
const { authService } = require('../../src/services/AuthService');
const { wazuhApiClient } = require('../../src/integrations/adapters/wazuh/wazuhApiInstance');
const armStore = require('../../src/services/wazuhRestartArmStore');

let adminToken;
const original = {};

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();

  const email = `restart-admin-${Date.now()}-${Math.random()}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: 'admin', role: 'admin' });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  adminToken = res.body.token;

  original.managerRestartEnabled = config.wazuh.managerRestartEnabled;
  original.isEnabled = wazuhApiClient.isEnabled;
  original.validateConfiguration = wazuhApiClient.validateConfiguration;
  original.restartManager = wazuhApiClient.restartManager;

  await armStore.setArmed(false);
});

afterEach(async () => {
  config.wazuh.managerRestartEnabled = original.managerRestartEnabled;
  wazuhApiClient.isEnabled = original.isEnabled;
  wazuhApiClient.validateConfiguration = original.validateConfiguration;
  wazuhApiClient.restartManager = original.restartManager;
  await armStore.setArmed(false);
});

const restart = (body = {}) =>
  request(app).post('/api/v1/wazuh/manager/restart').set('Authorization', `Bearer ${adminToken}`).send(body);

describe('Restart-Gate: ENV ODER DB-Arm', () => {
  test('ENV aus + nicht scharf → 403 disabled (kein Restart)', async () => {
    config.wazuh.managerRestartEnabled = false;
    wazuhApiClient.isEnabled = () => true;

    const res = await restart();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('disabled');
  });

  test('ENV aus + per DB scharfgeschaltet → Gate offen, Restart läuft (200)', async () => {
    config.wazuh.managerRestartEnabled = false;
    await armStore.setArmed(true);
    wazuhApiClient.isEnabled = () => true;
    wazuhApiClient.validateConfiguration = async () => ({ ok: true, status: 'OK' });
    wazuhApiClient.restartManager = async () => ({ confirmed: true });

    const res = await restart({ validate: false });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.restarted).toBe(true);
  });

  test('ENV an (DB aus) → Gate offen (ENV-Fallback bleibt aktiv)', async () => {
    config.wazuh.managerRestartEnabled = true;
    await armStore.setArmed(false);
    wazuhApiClient.isEnabled = () => true;
    wazuhApiClient.restartManager = async () => ({ confirmed: true });

    const res = await restart({ validate: false });
    expect(res.status).toBe(200);
    expect(res.body.restarted).toBe(true);
  });
});
