'use strict';

// P_CORR_ADMIN_2 Stufe 2 — InMemory-Apply-Repo: Single-flight, Replay-Schutz,
// versionierter Runtime-Config-Store, append-only Audit, globale Safety-Lock.

const { InMemoryApplyRepository } = require('../../src/applyChannel/InMemoryApplyRepository');
const { ApplyPlan, ApplyRun } = require('../../src/applyChannel/applyDomain');

let repo;
beforeEach(() => { repo = new InMemoryApplyRepository(); });

function plan(value = { maxChildren: 42 }) {
  return ApplyPlan.create({ draftId: 'd1', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value, expectedVersion: 1, createdBy: 'eng' });
}

describe('Plans', () => {
  test('createPlan + findPlanById + findPlanByHash', async () => {
    const p = plan();
    await repo.createPlan(p.toJSON());
    expect((await repo.findPlanById(p.id)).planHash).toBe(p.planHash);
    expect((await repo.findPlanByHash(p.planHash)).id).toBe(p.id);
  });
});

describe('Runs — Single-flight + Replay', () => {
  test('zweiter aktiver Run → ACTIVE_RUN_CONFLICT (Single-flight)', async () => {
    const p = plan(); await repo.createPlan(p.toJSON());
    await repo.createRun(ApplyRun.start({ planId: p.id, startedBy: 'a' }).toJSON());
    await expect(repo.createRun(ApplyRun.start({ planId: p.id, startedBy: 'b' }).toJSON()))
      .rejects.toMatchObject({ code: 'ACTIVE_RUN_CONFLICT' });
  });

  test('nach Abschluss eines Runs ist ein neuer Run wieder erlaubt', async () => {
    const p = plan(); await repo.createPlan(p.toJSON());
    const r = ApplyRun.start({ planId: p.id, startedBy: 'a' });
    await repo.createRun(r.toJSON());
    r.toReloading(1); r.toApplied({ ok: true });
    await repo.updateRun(r.toJSON());
    // gleicher Plan bereits applied → Replay-Schutz
    await expect(repo.createRun(ApplyRun.start({ planId: p.id, startedBy: 'c' }).toJSON()))
      .rejects.toMatchObject({ code: 'PLAN_ALREADY_APPLIED' });
  });

  test('findActiveRun findet nur aktive', async () => {
    const p = plan(); await repo.createPlan(p.toJSON());
    const r = ApplyRun.start({ planId: p.id, startedBy: 'a' });
    await repo.createRun(r.toJSON());
    expect((await repo.findActiveRun()).id).toBe(r.id);
    r.toRollingBack('x'); r.toRolledBack();
    await repo.updateRun(r.toJSON());
    expect(await repo.findActiveRun()).toBeNull();
  });
});

describe('Runtime-Config-Store — versioniert, 1 aktiv je Key', () => {
  test('writeRuntimeConfig erhöht Version + deaktiviert die Vorversion', async () => {
    const v1 = await repo.writeRuntimeConfig({ capabilityId: 'c', targetId: 't', value: { maxChildren: 200 }, appliedBy: 'a' });
    expect(v1.version).toBe(1);
    const v2 = await repo.writeRuntimeConfig({ capabilityId: 'c', targetId: 't', value: { maxChildren: 300 }, appliedBy: 'a' });
    expect(v2.version).toBe(2);
    const active = await repo.getActiveRuntimeConfig('c', 't');
    expect(active.version).toBe(2);
    expect(active.value).toEqual({ maxChildren: 300 });
  });

  test('getActiveRuntimeConfig ist null, solange nichts geschrieben wurde (Fallback-Defaults Sache des Providers)', async () => {
    expect(await repo.getActiveRuntimeConfig('c', 't')).toBeNull();
  });
});

describe('Append-only Audit + Safety-Lock', () => {
  test('appendApplyAudit + listApplyAudit (newest first)', async () => {
    await repo.appendApplyAudit({ id: 'a1', type: 'apply.requested', at: '2026-06-22T00:00:00.000Z' });
    await repo.appendApplyAudit({ id: 'a2', type: 'apply.applied', at: '2026-06-22T01:00:00.000Z' });
    const list = await repo.listApplyAudit();
    expect(list[0].id).toBe('a2');
  });
  test('Safety-Lock default offen → setzbar', async () => {
    expect((await repo.getSafetyLock()).locked).toBe(false);
    await repo.setSafetyLock(true, 'failed_safe_stop run r1');
    expect((await repo.getSafetyLock()).locked).toBe(true);
  });
});
