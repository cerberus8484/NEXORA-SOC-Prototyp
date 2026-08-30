'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let analystToken;
let adminToken;

async function mkUser(role) {
  const email = `det-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}

beforeAll(async () => {
  analystToken = await mkUser('analyst');
  adminToken   = await mkUser('admin');
});

const BASE      = '/api/v1/detections';
const DRAFT_BASE = '/api/v1/use-case-drafts';

const as = (t) => ({
  get:  (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

// ─── GET /v1/detections/published ────────────────────────────────────────────

describe('GET /v1/detections/published', () => {
  it('unauth → 401', async () => {
    const res = await request(app).get(`${BASE}/published`);
    expect(res.status).toBe(401);
  });

  it('liefert { data: [], total: 0 } wenn nichts published wurde', async () => {
    const res = await as(analystToken).get(`${BASE}/published`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body).toHaveProperty('requestId');
  });

  it('PublishedDetection erscheint nach Publish in der Liste', async () => {
    // Lifecycle: generate → review → approve → publish
    const gen  = await as(analystToken).post(`${DRAFT_BASE}/generate`, { sourceType: 'manual', sourceId: 'pd-test-1' });
    expect(gen.status).toBe(201);
    const id = gen.body.data.id;

    await as(analystToken).post(`${DRAFT_BASE}/${id}/review`);

    // engineer für approve anlegen
    const engEmail = `eng-det-${Date.now()}@x.io`;
    await authService.register({ email: engEmail, password: 'Test1234!', displayName: 'eng', role: 'engineer' });
    const engToken = (await request(app).post('/api/v1/auth/login').send({ email: engEmail, password: 'Test1234!' })).body.token;
    await request(app).post(`${DRAFT_BASE}/${id}/approve`).set('Authorization', `Bearer ${engToken}`).send({});

    // publish durch admin
    const pub = await as(adminToken).post(`${DRAFT_BASE}/${id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.status).toBe('published');

    // Jetzt in der Liste prüfen
    const list = await as(analystToken).get(`${BASE}/published`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);

    const entry = list.body.data.find((d) => d.draftId === id);
    expect(entry).toBeDefined();
    expect(entry.draftId).toBe(id);
    expect(entry.title).toBeTruthy();
    expect(entry).not.toHaveProperty('testCases'); // DSGVO
  });

  it('Idempotenz: doppeltes Publish erzeugt keinen zweiten Eintrag', async () => {
    // Ersten Lifecycle durchlaufen
    const gen = await as(analystToken).post(`${DRAFT_BASE}/generate`, { sourceType: 'manual', sourceId: 'idem-1' });
    const id  = gen.body.data.id;

    await as(analystToken).post(`${DRAFT_BASE}/${id}/review`);

    const eng2Email = `eng2-det-${Date.now()}@x.io`;
    await authService.register({ email: eng2Email, password: 'Test1234!', displayName: 'eng2', role: 'engineer' });
    const eng2Token = (await request(app).post('/api/v1/auth/login').send({ email: eng2Email, password: 'Test1234!' })).body.token;
    await request(app).post(`${DRAFT_BASE}/${id}/approve`).set('Authorization', `Bearer ${eng2Token}`).send({});
    await as(adminToken).post(`${DRAFT_BASE}/${id}/publish`);

    // Zweiter Publish-Versuch → 409 (Domain-Validierung)
    const pub2 = await as(adminToken).post(`${DRAFT_BASE}/${id}/publish`);
    expect(pub2.status).toBe(409);

    // Trotzdem nur ein Eintrag in der Detection-Library für diese draftId
    const list  = await as(analystToken).get(`${BASE}/published`);
    const found = list.body.data.filter((d) => d.draftId === id);
    expect(found).toHaveLength(1);
  });
});
