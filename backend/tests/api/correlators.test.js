'use strict';

// P_CORR_ADMIN_1 — /api/v1/correlators Routes: RBAC, unknown=deny, Pagination,
// keine Rohpayloads/Secrets, superseded korrekt beschrieben, Config-Bindung,
// approved ≠ applied. Echtes App + Token-Auth (InMemory-Repos, DB_ENABLED aus).

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let adminToken; let engineerToken; let analystToken; let viewerToken;

async function mkUser(role) {
  const email = `corr-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}
const as = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
  put: (u, b) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

const BASE = '/api/v1/correlators';
const ID = 'correlation-worker';
const CAP = 'correlator.worker.maxChildren';

beforeAll(async () => {
  adminToken = await mkUser('admin');
  engineerToken = await mkUser('engineer');
  analystToken = await mkUser('analyst');
  viewerToken = await mkUser('viewer');
});

describe('Correlators Routes — RBAC (read = analyst+)', () => {
  it('GET / ohne Auth → 401', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });
  it('viewer GET / → 403 (unter analyst)', async () => {
    expect((await as(viewerToken).get(BASE)).status).toBe(403);
  });
  it('analyst GET / → 200 (Registry lesbar)', async () => {
    const res = await as(analystToken).get(BASE);
    expect(res.status).toBe(200);
    const worker = res.body.data.find((c) => c.id === ID);
    expect(worker).toBeTruthy();
    expect(worker.engineVersion).toBe('ce-4');
    expect(worker.queue).toBeTruthy();
  });
  it('analyst POST /:id/drafts → 403 (read-only Rolle)', async () => {
    expect((await as(analystToken).post(`${BASE}/${ID}/drafts`, { capabilityId: CAP, value: { maxChildren: 5 } })).status).toBe(403);
  });
  it('engineer POST decision → 403 (nur admin)', async () => {
    const d = (await as(engineerToken).post(`${BASE}/${ID}/drafts`, { capabilityId: CAP, value: { maxChildren: 5 } })).body.data;
    await as(engineerToken).post(`${BASE}/${ID}/drafts/${d.id}/submit`, { expectedVersion: d.version });
    expect((await as(engineerToken).post(`${BASE}/${ID}/drafts/${d.id}/decision`, { decision: 'approved', expectedVersion: d.version + 1 })).status).toBe(403);
  });
});

describe('Correlators Routes — unknown = deny', () => {
  it('GET /:id unbekannt → 404', async () => {
    expect((await as(analystToken).get(`${BASE}/does-not-exist`)).status).toBe(404);
  });
  it('GET /:id/jobs unbekannt → 404', async () => {
    expect((await as(analystToken).get(`${BASE}/does-not-exist/jobs`)).status).toBe(404);
  });
});

describe('Correlators Routes — Detail / Config / Pagination', () => {
  it('GET /:id liefert Stammdaten + Queue-Summary', async () => {
    const res = await as(analystToken).get(`${BASE}/${ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ID);
    expect(res.body.data.configCapabilityIds).toContain(CAP);
    expect(res.body.data.queue).toHaveProperty('superseded');
  });

  it('GET /:id/jobs akzeptiert limit/offset und antwortet bounded', async () => {
    const res = await as(analystToken).get(`${BASE}/${ID}/jobs?limit=5&offset=0`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  it('GET /:id/config zeigt gebundene + reservierte Capabilities (applyStatus not_supported)', async () => {
    const res = await as(analystToken).get(`${BASE}/${ID}/config`);
    expect(res.status).toBe(200);
    expect(res.body.data.bound.map((b) => b.id)).toContain(CAP);
    expect(res.body.data.bound.every((b) => b.applyStatus === 'not_supported')).toBe(true);
    expect(res.body.data.reserved.every((r) => r.editable === false)).toBe(true);
  });
});

describe('Correlators Routes — Config-Bindung (nur erlaubte Capabilities)', () => {
  it('nicht gebundene Capability → 400 deny', async () => {
    const res = await as(engineerToken).post(`${BASE}/${ID}/drafts`, { capabilityId: 'collector.firewall.maxLineBytes', value: { maxLineBytes: 4096 } });
    expect(res.status).toBe(400);
  });
  it('unbekannte Capability → 400 deny', async () => {
    expect((await as(engineerToken).post(`${BASE}/${ID}/drafts`, { capabilityId: 'free.key', value: {} })).status).toBe(400);
  });
  it('reservierte host-Capability ist nicht über den Correlator administrierbar → 400', async () => {
    expect((await as(engineerToken).post(`${BASE}/${ID}/drafts`, { capabilityId: 'host.network.allowlist', value: { cidrs: [] } })).status).toBe(400);
  });
});

describe('Correlators Routes — Lifecycle (approved ≠ applied)', () => {
  it('create → submit → admin approve liefert approved OHNE applied-Feld', async () => {
    const d = (await as(engineerToken).post(`${BASE}/${ID}/drafts`, { capabilityId: CAP, value: { maxChildren: 99 } })).body.data;
    expect(d.status).toBe('draft');
    const sub = (await as(engineerToken).post(`${BASE}/${ID}/drafts/${d.id}/submit`, { expectedVersion: d.version })).body.data;
    expect(sub.status).toBe('pending_approval');
    const appr = await as(adminToken).post(`${BASE}/${ID}/drafts/${d.id}/decision`, { decision: 'approved', expectedVersion: sub.version, note: 'ok' });
    expect(appr.status).toBe(200);
    expect(appr.body.data.status).toBe('approved');
    expect(appr.body.data).not.toHaveProperty('applied');
    expect(appr.body.data).not.toHaveProperty('appliedAt');
  });

  it('sensibles Feld bleibt in der Audit-/Draft-Antwort redigiert (keine Klartext-Leaks)', async () => {
    // Der Audit-Endpoint des Correlators darf keine Rohinhalte/Secrets enthalten.
    await as(engineerToken).post(`${BASE}/${ID}/drafts`, { capabilityId: CAP, value: { maxChildren: 7 } });
    const res = await as(analystToken).get(`${BASE}/${ID}/audit`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|token/i);
    // Audit der gebundenen Capabilities — nur correlator.worker.*
    expect(res.body.data.every((a) => a.capabilityId.startsWith('correlator.worker.'))).toBe(true);
  });

  it('Draft eines fremden (nicht gebundenen) Ziels ist über den Correlator nicht änderbar', async () => {
    // Direkt über /config einen firewall-collector-Draft anlegen …
    const foreign = (await as(engineerToken).post('/api/v1/config/drafts', { capabilityId: 'collector.firewall.maxLineBytes', targetId: 'firewall-collector', value: { maxLineBytes: 4096 } })).body.data;
    // … und versuchen, ihn über den Correlator einzureichen → 400 (gehört nicht zu diesem Correlator).
    const res = await as(engineerToken).post(`${BASE}/${ID}/drafts/${foreign.id}/submit`, { expectedVersion: foreign.version });
    expect(res.status).toBe(400);
  });
});
