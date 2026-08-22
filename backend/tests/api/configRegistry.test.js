'use strict';

// P_CONFIG_1 — /api/v1/config Routes: RBAC, Allowlist-deny, Redaction, Lifecycle.
// Echtes App + Token-Auth (InMemory-Repos, DB_ENABLED aus). KEIN Apply-Endpunkt.

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let adminToken; let engineerToken; let analystToken;

async function mkUser(role) {
  const email = `cfg-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}
const as = (t) => ({
  get:  (u)    => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
  put:  (u, b) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

const BASE = '/api/v1/config';
const CAP = 'correlator.worker.maxChildren';
const TARGET = 'correlation-worker';

beforeAll(async () => {
  adminToken = await mkUser('admin');
  engineerToken = await mkUser('engineer');
  analystToken = await mkUser('analyst');
});

describe('Config Routes — RBAC', () => {
  it('POST /drafts ohne Auth → 401', async () => {
    expect((await request(app).post(`${BASE}/drafts`).send({ capabilityId: CAP, targetId: TARGET, value: { maxChildren: 5 } })).status).toBe(401);
  });
  it('analyst POST /drafts → 403 (read-only)', async () => {
    expect((await as(analystToken).post(`${BASE}/drafts`, { capabilityId: CAP, targetId: TARGET, value: { maxChildren: 5 } })).status).toBe(403);
  });
  it('analyst GET /capabilities → 200 (read erlaubt)', async () => {
    const res = await as(analystToken).get(`${BASE}/capabilities`);
    expect(res.status).toBe(200);
    const cap = res.body.data.find((c) => c.id === CAP);
    expect(cap).toBeTruthy();
    expect(cap.applyStatus).toBe('not_supported');
  });
  it('engineer POST /drafts/:id/decision → 403 (nur admin)', async () => {
    const d = (await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: CAP, targetId: TARGET, value: { maxChildren: 5 } })).body.data;
    await as(engineerToken).post(`${BASE}/drafts/${d.id}/submit`, { expectedVersion: d.version });
    expect((await as(engineerToken).post(`${BASE}/drafts/${d.id}/decision`, { decision: 'approved', expectedVersion: d.version + 1 })).status).toBe(403);
  });
});

describe('Config Routes — Allowlist deny', () => {
  it('unbekannte Capability → 400', async () => {
    expect((await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: 'free.key.anything', targetId: TARGET, value: {} })).status).toBe(400);
  });
  it('reservierte host-Capability → 403', async () => {
    expect((await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: 'host.network.allowlist', targetId: 'host-fw', value: { cidrs: [] } })).status).toBe(403);
  });
  it('GET /capabilities/:id unbekannt → 400', async () => {
    expect((await as(engineerToken).get(`${BASE}/capabilities/free.key`)).status).toBe(400);
  });
});

describe('Config Routes — Redaction', () => {
  it('sensitives Feld ist in der API-Antwort redigiert', async () => {
    const res = await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: 'integration.notify.targetRef', targetId: 'notify', value: { targetRef: 'channel://ops-secret' } });
    expect(res.status).toBe(201);
    expect(res.body.data.value.targetRef).toBe('***redacted***');
    expect(JSON.stringify(res.body)).not.toContain('ops-secret');
  });
});

describe('Config Routes — Lifecycle (approved ≠ applied, Optimistic Lock)', () => {
  it('create → submit → admin decision approved (kein Apply-Feld)', async () => {
    const d = (await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: CAP, targetId: TARGET, value: { maxChildren: 42 } })).body.data;
    expect(d.status).toBe('draft'); expect(d.version).toBe(1);
    const sub = (await as(engineerToken).post(`${BASE}/drafts/${d.id}/submit`, { expectedVersion: d.version })).body.data;
    expect(sub.status).toBe('pending_approval');
    const appr = await as(adminToken).post(`${BASE}/drafts/${d.id}/decision`, { decision: 'approved', expectedVersion: sub.version, note: 'ok' });
    expect(appr.status).toBe(200);
    expect(appr.body.data.status).toBe('approved');
    expect(appr.body.data).not.toHaveProperty('applied');
    expect(appr.body.data).not.toHaveProperty('appliedAt');
  });

  it('PUT mit falscher expectedVersion → 409', async () => {
    const d = (await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: CAP, targetId: TARGET, value: { maxChildren: 5 } })).body.data;
    await as(engineerToken).put(`${BASE}/drafts/${d.id}`, { value: { maxChildren: 6 }, expectedVersion: 1 });
    expect((await as(engineerToken).put(`${BASE}/drafts/${d.id}`, { value: { maxChildren: 7 }, expectedVersion: 1 })).status).toBe(409);
  });

  it('Audit-Endpoint liefert die Lifecycle-Übergänge', async () => {
    const d = (await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: CAP, targetId: TARGET, value: { maxChildren: 8 } })).body.data;
    await as(engineerToken).post(`${BASE}/drafts/${d.id}/submit`, { expectedVersion: d.version });
    const res = await as(engineerToken).get(`${BASE}/drafts/${d.id}/audit`);
    expect(res.status).toBe(200);
    const types = res.body.data.map((a) => a.type);
    expect(types).toContain('config.draft.created');
    expect(types).toContain('config.draft.submitted');
  });
});
