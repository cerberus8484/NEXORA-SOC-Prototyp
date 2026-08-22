'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let analystToken, viewerToken;
beforeAll(async () => {
  const a = `uc-analyst-${Date.now()}@x.io`;
  await authService.register({ email: a, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: a, password: 'Test1234!' })).body.token;
  const v = `uc-viewer-${Date.now()}@x.io`;
  await authService.register({ email: v, password: 'Test1234!', displayName: 'V', role: 'viewer' });
  viewerToken = (await request(app).post('/api/v1/auth/login').send({ email: v, password: 'Test1234!' })).body.token;
});

const post = (body, tok = analystToken) =>
  request(app).post('/api/v1/use-cases').set('Authorization', `Bearer ${tok}`).send(body);
const get = (tok = analystToken) =>
  request(app).get('/api/v1/use-cases').set('Authorization', `Bearer ${tok}`);

describe('Use-Case-Bibliothek-API', () => {
  test('POST legt Use-Case an (201), author gesetzt', async () => {
    const res = await post({ value: `UC-${Date.now()} – Lateral Movement` });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.author).toContain('@x.io');
  });

  test('POST ohne value → 400', async () => {
    const res = await post({ value: '   ' });
    expect(res.status).toBe(400);
  });

  test('POST Duplikat → 409', async () => {
    const value = `UC-dup-${Date.now()}`;
    await post({ value });
    const res = await post({ value });
    expect(res.status).toBe(409);
  });

  test('viewer darf NICHT anlegen → 403', async () => {
    const res = await post({ value: `UC-v-${Date.now()}` }, viewerToken);
    expect(res.status).toBe(403);
  });

  test('GET listet, DELETE entfernt (204)', async () => {
    const created = await post({ value: `UC-del-${Date.now()}` });
    const id = created.body.data.id;
    const list = await get();
    expect(list.status).toBe(200);
    expect(list.body.data.some((u) => u.id === id)).toBe(true);
    const del = await request(app).delete(`/api/v1/use-cases/${id}`)
      .set('Authorization', `Bearer ${analystToken}`);
    expect(del.status).toBe(204);
  });

  test('DELETE unbekannte ID → 404', async () => {
    const del = await request(app).delete('/api/v1/use-cases/nope')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(del.status).toBe(404);
  });

  test('ohne Token → 401', async () => {
    const res = await request(app).get('/api/v1/use-cases');
    expect(res.status).toBe(401);
  });
});
