'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let analystToken; let engineerToken;

beforeAll(async () => {
  const a = `metrics-analyst-${Date.now()}@x.io`;
  await authService.register({ email: a, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: a, password: 'Test1234!' })).body.token;

  const e = `metrics-eng-${Date.now()}@x.io`;
  await authService.register({ email: e, password: 'Test1234!', displayName: 'Eng', role: 'engineer' });
  engineerToken = (await request(app).post('/api/v1/auth/login').send({ email: e, password: 'Test1234!' })).body.token;
});

describe('GET /api/v1/soc-metrics (RBAC + Shape)', () => {
  test('ohne Token → 401', async () => {
    expect((await request(app).get('/api/v1/soc-metrics')).status).toBe(401);
  });

  test('analyst → 403 (nur engineer/admin)', async () => {
    const res = await request(app).get('/api/v1/soc-metrics').set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  test('engineer → 200 mit KPI-Struktur + meta.capped', async () => {
    const res = await request(app).get('/api/v1/soc-metrics').set('Authorization', `Bearer ${engineerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d).toHaveProperty('mttr');
    expect(d).toHaveProperty('fpRate');
    expect(d).toHaveProperty('byState');
    expect(d).toHaveProperty('topRules');
    expect(d).toHaveProperty('analystLoad');
    expect(d.meta).toMatchObject({ capped: expect.any(Boolean) });
    // FP-Rate liefert jetzt classifiedCount als Nenner (Audit #3)
    expect(d.fpRate).toHaveProperty('classifiedCount');
  });

  test('engineer + gültiges ?since → 200, meta.since gesetzt (Audit #2)', async () => {
    const since = '2026-06-01T00:00:00.000Z';
    const res = await request(app).get(`/api/v1/soc-metrics?since=${encodeURIComponent(since)}`)
      .set('Authorization', `Bearer ${engineerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.since).toBe(since);
  });

  test('engineer + ungültiges ?since → 400 (kein stiller All-Time-Fallback)', async () => {
    const res = await request(app).get('/api/v1/soc-metrics?since=not-a-date')
      .set('Authorization', `Bearer ${engineerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('engineer ohne ?since → 200, meta.since = null', async () => {
    const res = await request(app).get('/api/v1/soc-metrics')
      .set('Authorization', `Bearer ${engineerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.since).toBeNull();
  });
});
