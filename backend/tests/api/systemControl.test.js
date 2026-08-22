'use strict';

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');
const { authService } = require('../../src/services/AuthService');
const { systemControlService } = require('../../src/services/systemControlServiceInstance');

let adminToken;
let analystToken;

async function loginAs(role, emailPrefix) {
  const email = `${emailPrefix}-${Date.now()}@test.local`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return res.body.token;
}

describe('system control routes', () => {
  const original = {};

  beforeEach(async () => {
    authService._users.clear();
    authService._blocklist.clear();
    adminToken = await loginAs('admin', 'sys-admin');
    analystToken = await loginAs('analyst', 'sys-analyst');

    original.restartEnabled = config.systemControl.restartEnabled;
    original.restartCommand = config.systemControl.restartCommand;
    original.updateEnabled = config.systemControl.updateEnabled;
    original.updateCommand = config.systemControl.updateCommand;
    original.repoRoot = config.systemControl.repoRoot;
    config.systemControl.restartEnabled = false;
    config.systemControl.restartCommand = '';
    config.systemControl.updateEnabled = false;
    config.systemControl.updateCommand = '';
    config.systemControl.repoRoot = process.cwd();

    systemControlService._runner = () => ({ pid: 111, once: () => {} });
    systemControlService._active = null;
    systemControlService._lastResult = null;
  });

  afterEach(() => {
    config.systemControl.restartEnabled = original.restartEnabled;
    config.systemControl.restartCommand = original.restartCommand;
    config.systemControl.updateEnabled = original.updateEnabled;
    config.systemControl.updateCommand = original.updateCommand;
    config.systemControl.repoRoot = original.repoRoot;
    systemControlService._active = null;
    systemControlService._lastResult = null;
  });

  test('GET /api/v1/system/control ist admin-only', async () => {
    const guest = await request(app).get('/api/v1/system/control');
    expect(guest.status).toBe(401);

    const analyst = await request(app).get('/api/v1/system/control')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(analyst.status).toBe(403);

    const admin = await request(app).get('/api/v1/system/control')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);
    expect(admin.body.data.actions).toHaveLength(2);
  });

  test('POST /api/v1/system/control/:actionId verlangt X-Reauth-Token fail-closed', async () => {
    config.systemControl.restartEnabled = true;
    config.systemControl.restartCommand = 'echo restart';

    const res = await request(app)
      .post('/api/v1/system/control/app-restart')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(401);
  });

  test('POST /api/v1/system/control/:actionId gibt 202 bei freigeschalteter Aktion + Reauth', async () => {
    config.systemControl.updateEnabled = true;
    config.systemControl.updateCommand = 'echo update';
    systemControlService._runner = () => ({ pid: 777, once: () => {} });

    const rt = (await request(app)
      .post('/api/v1/auth/deploy-reauth')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'Test1234!' })).body.data.reauthToken;

    const res = await request(app)
      .post('/api/v1/system/control/app-update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Reauth-Token', rt)
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.data.accepted).toBe(true);
    expect(res.body.data.actionId).toBe('app-update');
  });
});
