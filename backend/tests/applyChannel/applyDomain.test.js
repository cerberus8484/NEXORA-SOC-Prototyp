'use strict';

// P_CORR_ADMIN_2 Stufe 2 — Apply-Domain: immutabler Plan + Apply-Run-State-Machine.
// Reine Domäne (keine DB/HTTP). planHash deterministisch; Übergänge fail-closed.

const {
  ApplyPlan, ApplyRun, APPLY_RUN_STATUS, computePlanHash,
} = require('../../src/applyChannel/applyDomain');

describe('computePlanHash — deterministisch + feldordnungsstabil', () => {
  test('gleiche Eingabe → gleicher Hash, Feldreihenfolge egal', () => {
    const a = computePlanHash({ capabilityId: 'c', targetId: 't', value: { maxChildren: 5, x: 1 }, expectedVersion: 2 });
    const b = computePlanHash({ capabilityId: 'c', targetId: 't', value: { x: 1, maxChildren: 5 }, expectedVersion: 2 });
    expect(a).toBe(b);
  });
  test('Wertänderung → anderer Hash', () => {
    const a = computePlanHash({ capabilityId: 'c', targetId: 't', value: { maxChildren: 5 }, expectedVersion: 1 });
    const b = computePlanHash({ capabilityId: 'c', targetId: 't', value: { maxChildren: 6 }, expectedVersion: 1 });
    expect(a).not.toBe(b);
  });
  test('expectedVersion fließt in den Hash ein (Anti-TOCTOU)', () => {
    const a = computePlanHash({ capabilityId: 'c', targetId: 't', value: { maxChildren: 5 }, expectedVersion: 1 });
    const b = computePlanHash({ capabilityId: 'c', targetId: 't', value: { maxChildren: 5 }, expectedVersion: 2 });
    expect(a).not.toBe(b);
  });
});

describe('ApplyPlan — immutabler Snapshot', () => {
  test('create setzt planHash konsistent zu computePlanHash', () => {
    const p = ApplyPlan.create({ draftId: 'd1', capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 42 }, expectedVersion: 3, createdBy: 'eng' });
    expect(p.planHash).toBe(computePlanHash({ capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 42 }, expectedVersion: 3 }));
    expect(p.toJSON()).toMatchObject({ draftId: 'd1', capabilityId: 'correlator.worker.maxChildren', expectedVersion: 3 });
  });
  test('trägt KEINE Mutationsmethode', () => {
    const p = ApplyPlan.create({ draftId: 'd1', capabilityId: 'c', targetId: 't', value: {}, expectedVersion: 1, createdBy: 'x' });
    for (const m of ['apply', 'mutate', 'setValue', 'update']) expect(typeof p[m]).not.toBe('function');
  });
});

describe('ApplyRun — State-Machine (fail-closed)', () => {
  function newRun() { return ApplyRun.start({ planId: 'p1', startedBy: 'adm' }); }

  test('startet in applying', () => {
    expect(newRun().status).toBe(APPLY_RUN_STATUS.APPLYING);
  });

  test('Erfolgspfad applying → reloading → applied', () => {
    const r = newRun();
    r.toReloading(7);
    expect(r.status).toBe(APPLY_RUN_STATUS.RELOADING);
    expect(r.configVersion).toBe(7);
    r.toApplied({ ok: true });
    expect(r.status).toBe(APPLY_RUN_STATUS.APPLIED);
    expect(r.finishedAt).toBeTruthy();
  });

  test('Fehlerpfad → rolling_back → rolled_back', () => {
    const r = newRun();
    r.toReloading(7);
    r.toRollingBack('health timeout');
    expect(r.status).toBe(APPLY_RUN_STATUS.ROLLING_BACK);
    r.toRolledBack();
    expect(r.status).toBe(APPLY_RUN_STATUS.ROLLED_BACK);
  });

  test('Rollback-Versagen → failed_safe_stop', () => {
    const r = newRun();
    r.toRollingBack('write failed');
    r.toFailedSafeStop('rollback failed');
    expect(r.status).toBe(APPLY_RUN_STATUS.FAILED_SAFE_STOP);
    expect(r.failureReason).toMatch(/rollback failed/);
  });

  test('ungültiger Übergang wirft (kein stiller Fehlzustand)', () => {
    const r = newRun();
    r.toReloading(1); r.toApplied({ ok: true });
    expect(() => r.toReloading(2)).toThrow();      // applied ist terminal
    expect(() => r.toRollingBack('x')).toThrow();
  });

  test('applied ohne vorheriges reloading ist NICHT erlaubt', () => {
    const r = newRun();
    expect(() => r.toApplied({ ok: true })).toThrow(); // applying → applied direkt verboten
  });
});
