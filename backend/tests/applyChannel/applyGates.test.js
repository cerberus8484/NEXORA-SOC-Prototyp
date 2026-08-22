'use strict';

// P_CORR_ADMIN_2 Stufe 2 — Apply-Gates: reine, fail-closed Vorprüfung VOR jedem
// Schreibpfad. Jeder fehlende/abweichende Input → deny. Reihenfolge stabil.

const { evaluateApplyGates, GATE_CODES } = require('../../src/applyChannel/applyGates');
const { ApplyPlan } = require('../../src/applyChannel/applyDomain');

const CAP = 'correlator.worker.maxChildren';
const TARGET = 'correlation-worker';

function baseCtx(over = {}) {
  const draft = { status: 'approved', createdBy: 'eng@x', value: { maxChildren: 42 }, version: 3, ...(over.draft || {}) };
  const plan = ApplyPlan.create({ draftId: 'd1', capabilityId: CAP, targetId: TARGET, value: draft.value, expectedVersion: draft.version, createdBy: 'eng@x' }).toJSON();
  return {
    killSwitchEnabled: true,
    safetyLocked: false,
    capabilityId: CAP,
    draft,
    approverLabel: 'admin@x',
    plan,
    reauth: { ok: true, actor: 'admin@x' },
    actor: { label: 'admin@x', role: 'admin' },
    activeRun: null,
    appliedRun: null,
    ...over,
  };
}

describe('evaluateApplyGates — Happy Path', () => {
  test('alle Gates erfüllt → allowed', () => {
    expect(evaluateApplyGates(baseCtx())).toMatchObject({ allowed: true });
  });
});

describe('evaluateApplyGates — fail-closed je Gate', () => {
  test('Kill-Switch aus → deny E_KILL_SWITCH', () => {
    expect(evaluateApplyGates(baseCtx({ killSwitchEnabled: false }))).toMatchObject({ allowed: false, code: GATE_CODES.KILL_SWITCH });
  });
  test('globale Safety-Lock → deny E_SAFETY_LOCK', () => {
    expect(evaluateApplyGates(baseCtx({ safetyLocked: true }))).toMatchObject({ allowed: false, code: GATE_CODES.SAFETY_LOCK });
  });
  test('nicht-eligible Capability → deny E_NOT_ELIGIBLE', () => {
    const ctx = baseCtx({ capabilityId: 'collector.firewall.maxLineBytes' });
    expect(evaluateApplyGates(ctx)).toMatchObject({ allowed: false, code: GATE_CODES.NOT_ELIGIBLE });
  });
  test('Draft nicht approved → deny E_DRAFT_NOT_APPROVED', () => {
    expect(evaluateApplyGates(baseCtx({ draft: { status: 'pending_approval', createdBy: 'eng@x', value: { maxChildren: 42 }, version: 3 } })))
      .toMatchObject({ allowed: false, code: GATE_CODES.DRAFT_NOT_APPROVED });
  });
  test('planHash passt nicht (Wert nachträglich geändert) → deny E_PLAN_MISMATCH', () => {
    const ctx = baseCtx();
    ctx.draft = { ...ctx.draft, value: { maxChildren: 999 } }; // Draft änderte sich nach Freeze
    expect(evaluateApplyGates(ctx)).toMatchObject({ allowed: false, code: GATE_CODES.PLAN_MISMATCH });
  });
  test('expectedVersion abweichend (TOCTOU) → deny E_PLAN_MISMATCH', () => {
    const ctx = baseCtx();
    ctx.draft = { ...ctx.draft, version: 4 }; // Version hochgezählt seit Freeze
    expect(evaluateApplyGates(ctx)).toMatchObject({ allowed: false, code: GATE_CODES.PLAN_MISMATCH });
  });
  test('Ersteller == Approver → deny E_FOUR_EYES', () => {
    expect(evaluateApplyGates(baseCtx({ approverLabel: 'eng@x' }))) // == draft.createdBy
      .toMatchObject({ allowed: false, code: GATE_CODES.FOUR_EYES });
  });
  test('keine frische Reauth → deny E_REAUTH', () => {
    expect(evaluateApplyGates(baseCtx({ reauth: { ok: false, actor: 'admin@x' } })))
      .toMatchObject({ allowed: false, code: GATE_CODES.REAUTH });
  });
  test('Reauth-Actor ≠ Apply-Actor → deny E_REAUTH', () => {
    expect(evaluateApplyGates(baseCtx({ reauth: { ok: true, actor: 'someone@else' } })))
      .toMatchObject({ allowed: false, code: GATE_CODES.REAUTH });
  });
  test('aktiver Run vorhanden → deny E_ACTIVE_RUN (Single-flight)', () => {
    expect(evaluateApplyGates(baseCtx({ activeRun: { id: 'r0', status: 'applying' } })))
      .toMatchObject({ allowed: false, code: GATE_CODES.ACTIVE_RUN });
  });
  test('Plan bereits angewendet → deny E_REPLAY', () => {
    expect(evaluateApplyGates(baseCtx({ appliedRun: { id: 'r0', status: 'applied' } })))
      .toMatchObject({ allowed: false, code: GATE_CODES.REPLAY });
  });
});

describe('evaluateApplyGates — defensiv', () => {
  test('fehlender Kontext → deny (kein Crash, fail-closed)', () => {
    expect(evaluateApplyGates(undefined)).toMatchObject({ allowed: false });
    expect(evaluateApplyGates({})).toMatchObject({ allowed: false });
  });
});
