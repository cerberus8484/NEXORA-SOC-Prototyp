'use strict';

// P_CORR_ADMIN_2 Stufe 1 — /correlators .../validate + .../plan und /config-Pendants.
// Separate Validierung (nicht-mutierend) + redigiertes Apply-Plan-Artefakt.
// KEIN Apply: wouldApply=false, applyStatus=not_supported. RBAC + Bindung + Redaction.

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let adminToken; let engineerToken; let analystToken;

async function mkUser(role) {
  const email = `cap2-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}
const as = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

const CORR = '/api/v1/correlators/correlation-worker';
const CFG = '/api/v1/config';
const CAP = 'correlator.worker.maxChildren';

beforeAll(async () => {
  adminToken = await mkUser('admin');
  engineerToken = await mkUser('engineer');
  analystToken = await mkUser('analyst');
});

async function newCorrelatorDraft(value = { maxChildren: 42 }) {
  return (await as(engineerToken).post(`${CORR}/drafts`, { capabilityId: CAP, value })).body.data;
}

describe('Correlator validate — separat + nicht-mutierend', () => {
  it('engineer validate → valid:true, Draft-Version UNVERÄNDERT', async () => {
    const d = await newCorrelatorDraft();
    const res = await as(engineerToken).post(`${CORR}/drafts/${d.id}/validate`);
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    // nicht-mutierend: erneutes Lesen über den Plan zeigt unveränderten Draft-Status/-Version
    const after = (await as(analystToken).get(`${CORR}/drafts/${d.id}/plan`)).body.data;
    expect(after.draftStatus).toBe('draft');
  });

  it('analyst validate → 403 (Validieren ist Engineer-Aktion)', async () => {
    const d = await newCorrelatorDraft();
    expect((await as(analystToken).post(`${CORR}/drafts/${d.id}/validate`)).status).toBe(403);
  });
});

describe('Correlator apply-plan — Vorschau, KEIN Apply', () => {
  it('analyst plan → wouldApply:false, applyStatus not_supported, applyEligible:true', async () => {
    const d = await newCorrelatorDraft({ maxChildren: 300 });
    const res = await as(analystToken).get(`${CORR}/drafts/${d.id}/plan`);
    expect(res.status).toBe(200);
    expect(res.body.data.wouldApply).toBe(false);
    expect(res.body.data.applyStatus).toBe('not_supported');
    expect(res.body.data.applyEligible).toBe(true);
    expect(res.body.data.applyImpact).toBe('reload');
    // Baseline = Default 200 → Änderung auf 300 sichtbar
    expect(res.body.data.changes).toEqual([{ key: 'maxChildren', before: 200, after: 300 }]);
  });

  it('unbekannter Correlator → 404, fremder Draft → 400', async () => {
    const d = await newCorrelatorDraft();
    expect((await as(analystToken).get(`/api/v1/correlators/nope/drafts/${d.id}/plan`)).status).toBe(404);
  });
});

describe('Config validate/plan — applyEligible & Redaction', () => {
  it('nicht-eligible Capability (firewall) → plan.applyEligible:false, wouldApply:false', async () => {
    const d = (await as(engineerToken).post(`${CFG}/drafts`, { capabilityId: 'collector.firewall.maxLineBytes', targetId: 'firewall-collector', value: { maxLineBytes: 4096 } })).body.data;
    const res = await as(engineerToken).get(`${CFG}/drafts/${d.id}/plan`);
    expect(res.status).toBe(200);
    expect(res.body.data.applyEligible).toBe(false);
    expect(res.body.data.wouldApply).toBe(false);
    expect(res.body.data.applyStatus).toBe('not_supported');
  });

  it('sensibles Feld bleibt in Validierung + Plan redigiert (kein Klartext-Leak)', async () => {
    const d = (await as(engineerToken).post(`${CFG}/drafts`, { capabilityId: 'integration.notify.targetRef', targetId: 'notify', value: { targetRef: 'channel://ops-secret' } })).body.data;
    const val = await as(engineerToken).post(`${CFG}/drafts/${d.id}/validate`);
    const plan = await as(engineerToken).get(`${CFG}/drafts/${d.id}/plan`);
    expect(JSON.stringify(val.body)).not.toContain('ops-secret');
    expect(JSON.stringify(plan.body)).not.toContain('ops-secret');
    expect(plan.body.data.applyEligible).toBe(false); // notify ist NICHT apply-eligible
  });
});
