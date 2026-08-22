'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let analystToken; let adminToken;
const BASE = '/api/v1/tickets/00000000-0000-0000-0000-000000000999/fp-exception';
const SCOPE = { ruleId: '87702', srcips: ['192.168.240.109'], dstips: ['224.0.0.0/24'], reason: 'multicast fp' };

beforeAll(async () => {
  const a = `fp-analyst-${Date.now()}@x.io`;
  await authService.register({ email: a, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: a, password: 'Test1234!' })).body.token;

  const d = `fp-admin-${Date.now()}@x.io`;
  await authService.register({ email: d, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email: d, password: 'Test1234!' })).body.token;
});

const as = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

describe('Wazuh FP-Exception Endpoints (RBAC)', () => {
  test('analyst → 403 auf apply/restart/revert', async () => {
    expect((await as(analystToken).post(`${BASE}/apply`, SCOPE)).status).toBe(403);
    expect((await as(analystToken).post(`${BASE}/restart`, { exceptionId: 'x' })).status).toBe(403);
    expect((await as(analystToken).post(`${BASE}/revert`, { exceptionId: 'x' })).status).toBe(403);
  });

  test('analyst darf GET (lesen) + Capabilities sichtbar', async () => {
    const res = await as(analystToken).get(BASE);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.capabilities).toMatchObject({ applyEnabled: false }); // Safety-Gate Default
  });

  test('SAFETY GATE (Default WAZUH_FP_APPLY_ENABLED!=true): admin apply/restart/revert → 403 disabled', async () => {
    const a = await as(adminToken).post(`${BASE}/apply`, SCOPE);
    expect(a.status).toBe(403);
    expect(a.body.disabled).toBe(true);
    expect(a.body.errors.join(' ')).toMatch(/disabled by configuration/);

    expect((await as(adminToken).post(`${BASE}/restart`, { exceptionId: 'x' })).status).toBe(403);
    expect((await as(adminToken).post(`${BASE}/revert`, { exceptionId: 'x' })).status).toBe(403);
  });

  test('Preview bleibt erlaubt (nicht vom Gate betroffen)', async () => {
    const res = await as(analystToken).post(`${BASE}/preview`, SCOPE);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  describe('quick (Ein-Klick, rollenabhängig)', () => {
    test('unauth → 401', async () => {
      expect((await request(app).post(`${BASE}/quick`).send(SCOPE)).status).toBe(401);
    });

    test('analyst → 200, action=forwarded (kein Write)', async () => {
      const res = await as(analystToken).post(`${BASE}/quick`, SCOPE);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.action).toBe('forwarded');
    });

    test('admin bei Safety-Gate AUS → forward statt apply (kein 403 Dead-End)', async () => {
      const res = await as(adminToken).post(`${BASE}/quick`, SCOPE);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.action).toBe('forwarded');
    });

    test('ungültiger/globaler Scope → 422, kein action=applied', async () => {
      const res = await as(adminToken).post(`${BASE}/quick`, { ruleId: '87702', reason: 'x' });
      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
    });
  });
});
