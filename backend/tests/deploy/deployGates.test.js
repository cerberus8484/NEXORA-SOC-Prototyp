'use strict';

// Deployment Center — Phase 4: Deploy-Gates (rein, fail-closed).
// Reihenfolge: Kontext → Kill-Switch → Safety-Lock → approved → Vier-Augen →
//   Reauth (actor-gebunden) → Single-flight → Replay.

const { evaluateDeployGates, DEPLOY_GATE_CODES } = require('../../src/deploy/deployGates');

function baseCtx(overrides = {}) {
  return {
    killSwitchEnabled: true,
    safetyLocked: false,
    run: { status: 'approved' },
    creatorLabel: 'alice',
    approverLabel: 'bob',
    reauth: { ok: true, actor: 'bob' },
    actor: { label: 'bob' },
    activeRun: false,
    deployedRun: false,
    ...overrides,
  };
}

describe('evaluateDeployGates — fail-closed', () => {
  test('vollständig erfüllt → allowed', () => {
    expect(evaluateDeployGates(baseCtx()).allowed).toBe(true);
  });

  test('kein Kontext → E_CONTEXT', () => {
    expect(evaluateDeployGates(null).code).toBe(DEPLOY_GATE_CODES.CONTEXT);
  });

  test('Kill-Switch aus → E_DEPLOY_DISABLED', () => {
    expect(evaluateDeployGates(baseCtx({ killSwitchEnabled: false })).code).toBe(DEPLOY_GATE_CODES.DISABLED);
  });

  test('Safety-Lock → E_SAFETY_LOCK', () => {
    expect(evaluateDeployGates(baseCtx({ safetyLocked: true })).code).toBe(DEPLOY_GATE_CODES.SAFETY_LOCK);
  });

  test('Run nicht approved → E_NOT_APPROVED', () => {
    expect(evaluateDeployGates(baseCtx({ run: { status: 'planned' } })).code).toBe(DEPLOY_GATE_CODES.NOT_APPROVED);
  });

  test('Ersteller == Genehmiger (Label) → E_FOUR_EYES', () => {
    expect(evaluateDeployGates(baseCtx({ creatorLabel: 'bob', approverLabel: 'bob' })).code).toBe(DEPLOY_GATE_CODES.FOUR_EYES);
  });

  test('gleiche User-ID trotz abweichendem Label → E_FOUR_EYES (ID hat Vorrang)', () => {
    // z.B. E-Mail-Case-Varianz (Bob@… vs bob@…), aber derselbe Account (sub).
    const ctx = baseCtx({ creatorId: 'u1', approverId: 'u1', creatorLabel: 'Bob@x', approverLabel: 'bob@x' });
    expect(evaluateDeployGates(ctx).code).toBe(DEPLOY_GATE_CODES.FOUR_EYES);
  });

  test('unterschiedliche User-IDs, gleiches Label → erlaubt (ID entscheidet)', () => {
    const ctx = baseCtx({ creatorId: 'u1', approverId: 'u2' });
    expect(evaluateDeployGates(ctx).allowed).toBe(true);
  });

  test('fehlende Reauth → E_REAUTH', () => {
    expect(evaluateDeployGates(baseCtx({ reauth: { ok: false } })).code).toBe(DEPLOY_GATE_CODES.REAUTH);
  });

  test('Reauth gehört nicht zum Actor → E_REAUTH', () => {
    expect(evaluateDeployGates(baseCtx({ reauth: { ok: true, actor: 'eve' }, actor: { label: 'bob' } })).code).toBe(DEPLOY_GATE_CODES.REAUTH);
  });

  test('aktiver Run → E_ACTIVE_RUN', () => {
    expect(evaluateDeployGates(baseCtx({ activeRun: true })).code).toBe(DEPLOY_GATE_CODES.ACTIVE_RUN);
  });

  test('Spec bereits deployt → E_REPLAY', () => {
    expect(evaluateDeployGates(baseCtx({ deployedRun: true })).code).toBe(DEPLOY_GATE_CODES.REPLAY);
  });

  test('Reihenfolge: Kill-Switch schlägt vor Vier-Augen', () => {
    const ctx = baseCtx({ killSwitchEnabled: false, creatorLabel: 'bob', approverLabel: 'bob' });
    expect(evaluateDeployGates(ctx).code).toBe(DEPLOY_GATE_CODES.DISABLED);
  });
});
