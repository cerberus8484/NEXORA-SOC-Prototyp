'use strict';

// P_CORR_ADMIN_2 Stufe 2 — ApplyExecutor: Gates → Run → Store-Write → Health →
// applied | Rollback → rolled_back | Rollback-Versagen → failed_safe_stop + Sperre.
// Append-only Audit je Schritt. Getestet gegen echtes InMemory-Repo + Fake-Health.

const { ApplyExecutor } = require('../../src/applyChannel/ApplyExecutor');
const { InMemoryApplyRepository } = require('../../src/applyChannel/InMemoryApplyRepository');
const { ApplyPlan, APPLY_RUN_STATUS } = require('../../src/applyChannel/applyDomain');

const CAP = 'correlator.worker.maxChildren';
const TARGET = 'correlation-worker';

function makePlan(value = { maxChildren: 300 }, expectedVersion = 3) {
  return ApplyPlan.create({ draftId: 'd1', capabilityId: CAP, targetId: TARGET, value, expectedVersion, createdBy: 'eng@x' });
}

// Health-Fake: liefert eine vorgegebene Ergebnis-Sequenz (1. = Apply, 2. = Rollback).
function healthFake(results) {
  let i = 0;
  return { checkHealth: async () => results[Math.min(i++, results.length - 1)] };
}
const HEALTHY = { healthy: true, configVersion: 1, heartbeatFresh: true, queueOk: true };
const UNHEALTHY = { healthy: false, reason: 'health timeout' };

function goodGateCtx(plan) {
  return {
    killSwitchEnabled: true, safetyLocked: false, capabilityId: CAP,
    draft: { status: 'approved', createdBy: 'eng@x', value: plan.value, version: plan.expectedVersion },
    approverLabel: 'admin@x', plan: plan.toJSON(),
    reauth: { ok: true, actor: 'admin@x' }, actor: { label: 'admin@x', role: 'admin' },
    activeRun: null, appliedRun: null,
  };
}

function build(health) {
  const repo = new InMemoryApplyRepository();
  const exec = new ApplyExecutor({ repo, workerHealth: health });
  return { repo, exec };
}

async function run(exec, repo, plan, gateCtx) {
  await repo.createPlan(plan.toJSON());
  return exec.execute({
    plan: plan.toJSON(), gateContext: gateCtx || goodGateCtx(plan),
    actor: { label: 'admin@x', role: 'admin' }, baselineValue: { maxChildren: 200 }, redact: (v) => v,
  });
}

describe('ApplyExecutor — Erfolgspfad', () => {
  test('healthy → applied, Store hat neue Version, Audit vollständig', async () => {
    const { repo, exec } = build(healthFake([HEALTHY]));
    const plan = makePlan();
    const res = await run(exec, repo, plan);
    expect(res.status).toBe(APPLY_RUN_STATUS.APPLIED);
    const active = await repo.getActiveRuntimeConfig(CAP, TARGET);
    expect(active.value).toEqual({ maxChildren: 300 });
    const audit = await repo.listApplyAudit();
    const types = audit.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(['apply.started', 'apply.written', 'apply.applied']));
  });
});

describe('ApplyExecutor — Rollback', () => {
  test('Apply unhealthy, Rollback healthy → rolled_back + Baseline aktiv', async () => {
    const { repo, exec } = build(healthFake([UNHEALTHY, HEALTHY]));
    const plan = makePlan();
    const res = await run(exec, repo, plan);
    expect(res.status).toBe(APPLY_RUN_STATUS.ROLLED_BACK);
    const active = await repo.getActiveRuntimeConfig(CAP, TARGET);
    expect(active.value).toEqual({ maxChildren: 200 }); // Baseline wiederhergestellt
    expect((await repo.getSafetyLock()).locked).toBe(false);
    expect((await repo.listApplyAudit()).map((a) => a.type)).toEqual(expect.arrayContaining(['apply.rolling_back', 'apply.rolled_back']));
  });
});

describe('ApplyExecutor — failed_safe_stop', () => {
  test('Apply unhealthy UND Rollback unhealthy → failed_safe_stop + globale Sperre', async () => {
    const { repo, exec } = build(healthFake([UNHEALTHY, UNHEALTHY]));
    const plan = makePlan();
    const res = await run(exec, repo, plan);
    expect(res.status).toBe(APPLY_RUN_STATUS.FAILED_SAFE_STOP);
    expect((await repo.getSafetyLock()).locked).toBe(true);
    expect((await repo.listApplyAudit()).map((a) => a.type)).toContain('apply.failed_safe_stop');
  });
});

describe('ApplyExecutor — Gates fail-closed', () => {
  test('Gate-Denial (Kill-Switch aus) → wirft 403, KEIN Run, KEIN Write', async () => {
    const { repo, exec } = build(healthFake([HEALTHY]));
    const plan = makePlan();
    await repo.createPlan(plan.toJSON());
    const ctx = goodGateCtx(plan); ctx.killSwitchEnabled = false;
    await expect(exec.execute({ plan: plan.toJSON(), gateContext: ctx, actor: { label: 'admin@x' }, baselineValue: { maxChildren: 200 }, redact: (v) => v }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(await repo.getActiveRuntimeConfig(CAP, TARGET)).toBeNull(); // nichts geschrieben
    expect(await repo.findActiveRun()).toBeNull();                      // kein Run
  });

  test('Safety-Lock bereits aktiv → wirft 403 (manueller Review)', async () => {
    const { repo, exec } = build(healthFake([HEALTHY]));
    await repo.setSafetyLock(true, 'prev failure');
    const plan = makePlan();
    await repo.createPlan(plan.toJSON());
    const ctx = goodGateCtx(plan); ctx.safetyLocked = true;
    await expect(exec.execute({ plan: plan.toJSON(), gateContext: ctx, actor: { label: 'admin@x' }, baselineValue: { maxChildren: 200 }, redact: (v) => v }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});
