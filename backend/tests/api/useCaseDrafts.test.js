'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let analystToken; let engineerToken; let adminToken;

async function mkUser(role) {
  const email = `ucd-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}

beforeAll(async () => {
  analystToken  = await mkUser('analyst');
  engineerToken = await mkUser('engineer');
  adminToken    = await mkUser('admin');
});

const as = (t) => ({
  get:  (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

const BASE = '/api/v1/use-case-drafts';

describe('Use-Case-Developer Endpoints (RBAC + Lifecycle)', () => {
  test('unauth → 401', async () => {
    expect((await request(app).post(`${BASE}/generate`).send({})).status).toBe(401);
  });

  test('analyst generate → 201 mit Draft + Quality (Stub-Provider)', async () => {
    const res = await as(analystToken).post(`${BASE}/generate`, { sourceType: 'manual', sourceId: 'm1' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.quality).toHaveProperty('passed');
  });

  test('voller Lifecycle: review (analyst) → approve (engineer) → publish (admin); RBAC blockt falsche Rollen', async () => {
    const gen = await as(analystToken).post(`${BASE}/generate`, { sourceType: 'manual', sourceId: 'lc1' });
    const id  = gen.body.data.id;

    // approve durch analyst → 403
    expect((await as(analystToken).post(`${BASE}/${id}/approve`)).status).toBe(403);

    // review durch analyst → 200, status in_review
    const rev = await as(analystToken).post(`${BASE}/${id}/review`);
    expect(rev.status).toBe(200);
    expect(rev.body.data.status).toBe('in_review');

    // approve durch engineer → 200
    const app1 = await as(engineerToken).post(`${BASE}/${id}/approve`);
    expect(app1.status).toBe(200);
    expect(app1.body.data.status).toBe('approved');

    // publish durch engineer → 403, durch admin → 200
    expect((await as(engineerToken).post(`${BASE}/${id}/publish`)).status).toBe(403);
    const pub = await as(adminToken).post(`${BASE}/${id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.status).toBe('published');
  });

  test('ungültiger Übergang → 409 (draft direkt approve)', async () => {
    const gen = await as(analystToken).post(`${BASE}/generate`, { sourceType: 'manual', sourceId: 'bad1' });
    const id  = gen.body.data.id;
    expect((await as(engineerToken).post(`${BASE}/${id}/approve`)).status).toBe(409);
  });

  test('list (auth) liefert { data, total }', async () => {
    const res = await as(analystToken).get(`${BASE}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });
});
