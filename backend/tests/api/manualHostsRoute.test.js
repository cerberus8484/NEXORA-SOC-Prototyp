/**
 * @jest-environment node
 */
'use strict';

// /api/v1/hosts/manual — Manual-Host-Quelle end-to-end (HTTP, InMemory).
// list (viewer+), create (admin + Validierung), delete (admin). RBAC + 404.

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

const BASE = '/api/v1/hosts/manual';

async function mkUser(role) {
  const email = `mh-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
  return { email, token };
}
const as = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
  del: (u) => request(app).delete(u).set('Authorization', `Bearer ${t}`),
});

let admin; let analyst;
beforeAll(async () => {
  admin = await mkUser('admin');
  analyst = await mkUser('analyst');
});

describe('POST /hosts/manual — anlegen (admin)', () => {
  test('admin legt einen Manual-Host an → 201, source=manual', async () => {
    const res = await as(admin.token).post(BASE, { hostname: 'fw-edge', ipAddresses: ['10.0.10.1'], os: 'OPNsense', customer: 'ACME' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ hostname: 'fw-edge', source: 'manual' });
    expect(res.body.data.id).toBeTruthy();
  });

  test('nicht-admin (analyst) → 403', async () => {
    const res = await as(analyst.token).post(BASE, { hostname: 'x' });
    expect(res.status).toBe(403);
  });

  test('ungültiger hostname → 400', async () => {
    const res = await as(admin.token).post(BASE, { hostname: 'bad host!' });
    expect(res.status).toBe(400);
  });

  test('ungültige IP → 400', async () => {
    const res = await as(admin.token).post(BASE, { hostname: 'ok', ipAddresses: ['999.1.1.1'] });
    expect(res.status).toBe(400);
  });
});

describe('GET /hosts/manual — liste (viewer+)', () => {
  test('listet angelegte Manual-Hosts', async () => {
    await as(admin.token).post(BASE, { hostname: 'listed-host' });
    const res = await as(analyst.token).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.some((h) => h.hostname === 'listed-host')).toBe(true);
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).get(BASE);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /hosts/manual/:id — entfernen (admin)', () => {
  test('admin entfernt → 200, danach weg', async () => {
    const created = await as(admin.token).post(BASE, { hostname: 'to-delete' });
    const id = created.body.data.id;
    const del = await as(admin.token).del(`${BASE}/${id}`);
    expect(del.status).toBe(200);
    const list = await as(admin.token).get(BASE);
    expect(list.body.data.some((h) => h.id === id)).toBe(false);
  });

  test('unbekannte id → 404', async () => {
    const res = await as(admin.token).del(`${BASE}/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });

  test('nicht-admin → 403', async () => {
    const created = await as(admin.token).post(BASE, { hostname: 'guarded' });
    const res = await as(analyst.token).del(`${BASE}/${created.body.data.id}`);
    expect(res.status).toBe(403);
  });
});
