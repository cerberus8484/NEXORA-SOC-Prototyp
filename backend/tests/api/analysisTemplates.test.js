'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let analystToken, viewerToken;
beforeAll(async () => {
  const a = `tpl-analyst-${Date.now()}@x.io`;
  await authService.register({ email: a, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: a, password: 'Test1234!' })).body.token;
  const v = `tpl-viewer-${Date.now()}@x.io`;
  await authService.register({ email: v, password: 'Test1234!', displayName: 'V', role: 'viewer' });
  viewerToken = (await request(app).post('/api/v1/auth/login').send({ email: v, password: 'Test1234!' })).body.token;
});

const post = (body, tok = analystToken) =>
  request(app).post('/api/v1/analysis-templates').set('Authorization', `Bearer ${tok}`).send(body);
const get = (url, tok = analystToken) =>
  request(app).get(url).set('Authorization', `Bearer ${tok}`);

describe('Analyse-Vorlagen-API', () => {
  test('POST legt Vorlage an (201), author = eingeloggter Nutzer', async () => {
    const res = await post({ name: `Phishing-${Date.now()}`, desc: 'Beschreibung', iocs: 'evil.com' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.desc).toBe('Beschreibung');
    expect(res.body.data.author).toContain('@x.io');
  });

  test('POST ohne Namen → 400', async () => {
    const res = await post({ desc: 'ohne name' });
    expect(res.status).toBe(400);
  });

  test('POST mit Duplikat-Namen → 409', async () => {
    const name = `Dup-${Date.now()}`;
    await post({ name });
    const res = await post({ name });
    expect(res.status).toBe(409);
  });

  test('viewer darf NICHT anlegen → 403', async () => {
    const res = await post({ name: `V-${Date.now()}` }, viewerToken);
    expect(res.status).toBe(403);
  });

  test('GET listet Vorlagen, GET/:id liefert eine', async () => {
    const created = await post({ name: `List-${Date.now()}`, rec: 'Empfehlung' });
    const id = created.body.data.id;
    const list = await get('/api/v1/analysis-templates');
    expect(list.status).toBe(200);
    expect(list.body.data.some((t) => t.id === id)).toBe(true);
    const one = await get(`/api/v1/analysis-templates/${id}`);
    expect(one.status).toBe(200);
    expect(one.body.data.rec).toBe('Empfehlung');
  });

  test('PUT aktualisiert Felder', async () => {
    const created = await post({ name: `Upd-${Date.now()}`, desc: 'alt' });
    const id = created.body.data.id;
    const res = await request(app).put(`/api/v1/analysis-templates/${id}`)
      .set('Authorization', `Bearer ${analystToken}`).send({ desc: 'neu' });
    expect(res.status).toBe(200);
    expect(res.body.data.desc).toBe('neu');
  });

  test('DELETE entfernt Vorlage (204), danach 404', async () => {
    const created = await post({ name: `Del-${Date.now()}` });
    const id = created.body.data.id;
    const del = await request(app).delete(`/api/v1/analysis-templates/${id}`)
      .set('Authorization', `Bearer ${analystToken}`);
    expect(del.status).toBe(204);
    const after = await get(`/api/v1/analysis-templates/${id}`);
    expect(after.status).toBe(404);
  });

  test('ohne Token → 401', async () => {
    const res = await request(app).get('/api/v1/analysis-templates');
    expect(res.status).toBe(401);
  });
});
