'use strict';

// P_NIS2_1 — /api/v1/nis2 Routes: RBAC, Flow, Validierung, ehrliche Sprache.
const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

const BASE = '/api/v1/nis2';
let adminToken; let viewerToken;

async function mkUser(role) {
  const email = `nis2-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}
const as = (t) => ({
  get:  (u)    => request(app).get(u).set('Authorization', `Bearer ${t}`),
  put:  (u, b) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b || {}),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
  del:  (u)    => request(app).delete(u).set('Authorization', `Bearer ${t}`),
});

beforeAll(async () => {
  adminToken = await mkUser('admin');
  viewerToken = await mkUser('viewer');
});

describe('NIS2 Routes — Read (viewer+)', () => {
  it('GET /controls ohne Auth → 401', async () => {
    expect((await request(app).get(`${BASE}/controls`)).status).toBe(401);
  });
  it('viewer GET /controls → 200, 10 Controls + Summary', async () => {
    const res = await as(viewerToken).get(`${BASE}/controls`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.summary.controlsTotal).toBe(10);
  });
  it('GET /catalog → 200, 10 Controls', async () => {
    const res = await as(viewerToken).get(`${BASE}/catalog`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
  });
  it('Antworten enthalten KEINEN Compliance-/Zertifizierungs-Claim', async () => {
    const dump = JSON.stringify((await as(viewerToken).get(`${BASE}/controls`)).body).toLowerCase();
    expect(dump).not.toMatch(/compliant|zertifiziert|konformitätsnachweis|rechtssicher/);
  });
});

describe('NIS2 Routes — RBAC Write (admin only)', () => {
  it('viewer PUT /assessments/:key → 403', async () => {
    expect((await as(viewerToken).put(`${BASE}/assessments/incident_handling`, { status: 'in_progress' })).status).toBe(403);
  });
  it('viewer POST evidence → 403', async () => {
    expect((await as(viewerToken).post(`${BASE}/assessments/incident_handling/evidence`, { evidenceType: 'ticket', evidenceRef: 'INC1', title: 'T' })).status).toBe(403);
  });
  it('admin PUT /assessments/:key → 200', async () => {
    const res = await as(adminToken).put(`${BASE}/assessments/incident_handling`, { status: 'in_progress', owner: 'SecTeam', dueDate: '2026-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');
  });
  it('unbekannter controlKey → 404', async () => {
    expect((await as(adminToken).put(`${BASE}/assessments/does_not_exist`, { status: 'in_progress' })).status).toBe(404);
  });
  it('not_applicable ohne Begründung → 400', async () => {
    expect((await as(adminToken).put(`${BASE}/assessments/incident_handling`, { status: 'not_applicable' })).status).toBe(400);
  });
});

describe('NIS2 Routes — Evidence-Flow + Validierung', () => {
  it('admin POST evidence → 201, erscheint im Detail', async () => {
    await as(adminToken).put(`${BASE}/assessments/cryptography_and_encryption`, { status: 'in_progress' });
    const res = await as(adminToken).post(`${BASE}/assessments/cryptography_and_encryption/evidence`, { evidenceType: 'document', evidenceRef: 'https://wiki.local/krypto', title: 'Krypto-Konzept' });
    expect(res.status).toBe(201);
    const detail = await as(viewerToken).get(`${BASE}/assessments/cryptography_and_encryption`);
    expect(detail.body.data.evidence.length).toBeGreaterThanOrEqual(1);
  });
  it('Secret-artige Evidence-URL → 400', async () => {
    const res = await as(adminToken).post(`${BASE}/assessments/cryptography_and_encryption/evidence`, { evidenceType: 'external_reference', evidenceRef: 'https://x.local/a?token=secret123', title: 'X' });
    expect(res.status).toBe(400);
  });
  it('javascript:-URL → 400', async () => {
    const res = await as(adminToken).post(`${BASE}/assessments/cryptography_and_encryption/evidence`, { evidenceType: 'external_reference', evidenceRef: 'javascript:alert(1)', title: 'X' });
    expect(res.status).toBe(400);
  });
  it('admin DELETE /evidence/:id → 204; viewer → 403', async () => {
    const ev = (await as(adminToken).post(`${BASE}/assessments/cryptography_and_encryption/evidence`, { evidenceType: 'document', evidenceRef: 'ref-del', title: 'Del' })).body.data;
    expect((await as(viewerToken).del(`${BASE}/evidence/${ev.id}`)).status).toBe(403);
    expect((await as(adminToken).del(`${BASE}/evidence/${ev.id}`)).status).toBe(204);
  });
});
