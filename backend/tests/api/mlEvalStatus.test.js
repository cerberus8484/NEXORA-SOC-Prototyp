'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { _resetForTest } = require('../../src/services/routingPolicyInstance');

let adminToken;
let analystToken;

beforeEach(async () => {
  _resetForTest();
  delete process.env.ML_ROUTING_POLICY_PATH;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await authService.register({ email: `mls-admin-${suffix}@x.io`, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email: `mls-admin-${suffix}@x.io`, password: 'Test1234!' })).body.token;
  await authService.register({ email: `mls-analyst-${suffix}@x.io`, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: `mls-analyst-${suffix}@x.io`, password: 'Test1234!' })).body.token;
});

afterEach(() => {
  _resetForTest();
  delete process.env.ML_ROUTING_POLICY_PATH;
});

describe('GET /api/v1/ml/eval/status', () => {
  test('ohne Auth → 401', async () => {
    expect((await request(app).get('/api/v1/ml/eval/status')).status).toBe(401);
  });

  test('analyst → 403 (admin only)', async () => {
    const res = await request(app).get('/api/v1/ml/eval/status').set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  test('admin → 200 mit inaktiver Routing-Policy (default, kein ENV)', async () => {
    const res = await request(app).get('/api/v1/ml/eval/status').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.routingPolicy.active).toBe(false);
    expect(res.body.data.routingPolicy.reason).toBe('unset');
    // Kein Dateipfad-Leak.
    expect(JSON.stringify(res.body.data)).not.toMatch(/ML_ROUTING_POLICY_PATH|\.json/);
  });
});
