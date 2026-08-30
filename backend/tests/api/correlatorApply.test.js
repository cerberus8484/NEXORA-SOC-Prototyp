'use strict';

// P_CORR_ADMIN_2 Stufe 2 — /correlators Apply-Kanal end-to-end (HTTP, InMemory).
// Reauth → Freeze → Apply (Kill-Switch an) → applied. Plus deny-Pfade: Kill-Switch aus,
// keine Reauth, RBAC, Replay. KEIN OS/Shell — nur DB-Store. Default-off bleibt sicher.

const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');
const { authService } = require('../../src/services/AuthService');
const { getApplyRepository } = require('../../src/applyChannel/applyRepositoryFactory');
const { getWorkerStatusRepository } = require('../../src/applyChannel/workerStatusRepositoryFactory');

let adminToken; let engineerToken; let analystToken; let adminEmail;

const WORKER_ID = 'correlation-worker';

// Simuliert den Live-Worker: hat die als-nächstes geschriebene Version übernommen,
// lebt (frischer Heartbeat) und verarbeitet (idle = gesund). Ohne das ist Health
// korrekt fail-closed (Stufe 3) und ein Apply würde zurückgerollt.
async function seedHealthyWorker(cap = CAP) {
  const active = await getApplyRepository().getActiveRuntimeConfig(cap, WORKER_ID);
  const expected = (active ? active.version : 0) + 1;
  await getWorkerStatusRepository().upsert(WORKER_ID, {
    lastHeartbeatAt: new Date().toISOString(),
    adoptedConfigVersions: { [cap]: expected },
    queueProcessingState: 'idle',
  });
}

async function mkUser(role) {
  const email = `ap-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
  return { email, token };
}
const as = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
  postH: (u, h, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).set(h).send(b || {}),
});

const BASE = '/api/v1/correlators/correlation-worker';
const CAP = 'correlator.worker.maxChildren';

beforeAll(async () => {
  const a = await mkUser('admin'); adminToken = a.token; adminEmail = a.email;
  engineerToken = (await mkUser('engineer')).token;
  analystToken = (await mkUser('analyst')).token;
  config.apply.healthTimeoutMs = 800; // schnell scheitern statt 10s hängen
});
afterEach(async () => {
  config.apply.enabled = false;             // immer fail-closed zurück
  await getApplyRepository().setSafetyLock(false, ''); // keine Lock-Kontamination zwischen Tests
});

// Engineer legt Draft an → einreicht → Admin genehmigt (Ersteller≠Approver).
async function approvedDraft(value = { maxChildren: 250 }) {
  const d = (await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: CAP, value })).body.data;
  await as(engineerToken).post(`${BASE}/drafts/${d.id}/submit`, { expectedVersion: d.version });
  const appr = (await as(adminToken).post(`${BASE}/drafts/${d.id}/decision`, { decision: 'approved', expectedVersion: d.version + 1, note: '' })).body.data;
  return { draftId: d.id, version: appr.version };
}
async function reauth() {
  return (await as(adminToken).post('/api/v1/auth/reauth', { password: 'Test1234!' })).body.data.reauthToken;
}

describe('Apply-Kanal — Happy Path (Kill-Switch an)', () => {
  it('freeze → reauth → apply → applied', async () => {
    config.apply.enabled = true;
    const { draftId } = await approvedDraft({ maxChildren: 251 });
    const plan = (await as(adminToken).post(`${BASE}/drafts/${draftId}/plan/freeze`)).body.data;
    expect(plan.planHash).toBeTruthy();

    await seedHealthyWorker();
    const rt = await reauth();
    const res = await as(adminToken).postH(`${BASE}/plans/${plan.id}/apply`, { 'X-Reauth-Token': rt });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('applied');

    // Audit vorhanden
    const audit = await as(analystToken).get(`${BASE}/apply-audit?planId=${plan.id}`);
    expect(audit.body.data.map((a) => a.type)).toEqual(expect.arrayContaining(['apply.plan_frozen', 'apply.applied']));
  });

  it('Replay desselben Plans → deny (bereits angewendet)', async () => {
    config.apply.enabled = true;
    const { draftId } = await approvedDraft({ maxChildren: 252 });
    const plan = (await as(adminToken).post(`${BASE}/drafts/${draftId}/plan/freeze`)).body.data;
    await seedHealthyWorker();
    const rt = await reauth();
    await as(adminToken).postH(`${BASE}/plans/${plan.id}/apply`, { 'X-Reauth-Token': rt });
    const rt2 = await reauth();
    const replay = await as(adminToken).postH(`${BASE}/plans/${plan.id}/apply`, { 'X-Reauth-Token': rt2 });
    expect([403, 409]).toContain(replay.status);
  });
});

describe('Apply-Kanal — deny-Pfade (fail-closed)', () => {
  it('Kill-Switch AUS → apply 403 (serverseitig gesperrt)', async () => {
    config.apply.enabled = true;
    const { draftId } = await approvedDraft({ maxChildren: 253 });
    const plan = (await as(adminToken).post(`${BASE}/drafts/${draftId}/plan/freeze`)).body.data;
    const rt = await reauth();
    config.apply.enabled = false; // jetzt sperren
    const res = await as(adminToken).postH(`${BASE}/plans/${plan.id}/apply`, { 'X-Reauth-Token': rt });
    expect(res.status).toBe(403);
  });

  it('ungesunder Worker (Live-Health fail-closed) → NICHT applied (Rollback/safe-stop)', async () => {
    config.apply.enabled = true;
    const { draftId } = await approvedDraft({ maxChildren: 257 });
    const plan = (await as(adminToken).post(`${BASE}/drafts/${draftId}/plan/freeze`)).body.data;
    // Worker meldet Queue-Stall → Health darf NICHT als gesund gelten.
    await getWorkerStatusRepository().upsert(WORKER_ID, { lastHeartbeatAt: new Date().toISOString(), adoptedConfigVersions: {}, queueProcessingState: 'stalled' });
    const rt = await reauth();
    const res = await as(adminToken).postH(`${BASE}/plans/${plan.id}/apply`, { 'X-Reauth-Token': rt });
    expect(res.status).toBe(200);
    expect(res.body.data.status).not.toBe('applied');
    expect(['rolled_back', 'failed_safe_stop']).toContain(res.body.data.status);
  });

  it('ohne Reauth-Token → apply 403', async () => {
    config.apply.enabled = true;
    const { draftId } = await approvedDraft({ maxChildren: 254 });
    const plan = (await as(adminToken).post(`${BASE}/drafts/${draftId}/plan/freeze`)).body.data;
    const res = await as(adminToken).post(`${BASE}/plans/${plan.id}/apply`); // kein Header
    expect(res.status).toBe(403);
  });

  it('analyst freeze/apply → 403 (RBAC, nur admin)', async () => {
    config.apply.enabled = true;
    const { draftId } = await approvedDraft({ maxChildren: 255 });
    expect((await as(analystToken).post(`${BASE}/drafts/${draftId}/plan/freeze`)).status).toBe(403);
    expect((await as(analystToken).post(`${BASE}/plans/whatever/apply`)).status).toBe(403);
  });

  it('engineer kann nicht einfrieren (nur admin)', async () => {
    const { draftId } = await approvedDraft({ maxChildren: 256 });
    expect((await as(engineerToken).post(`${BASE}/drafts/${draftId}/plan/freeze`)).status).toBe(403);
  });

  it('Reauth-Endpoint mit falschem Passwort → kein Token (401)', async () => {
    const res = await as(adminToken).post('/api/v1/auth/reauth', { password: 'WRONG' });
    expect(res.status).toBe(401);
  });
});

describe('Apply-Kanal — Freeze-Vorbedingungen', () => {
  it('nicht genehmigter Draft → freeze 409', async () => {
    config.apply.enabled = true;
    const d = (await as(engineerToken).post(`${BASE}/drafts`, { capabilityId: CAP, value: { maxChildren: 260 } })).body.data;
    expect((await as(adminToken).post(`${BASE}/drafts/${d.id}/plan/freeze`)).status).toBe(409);
  });
});
