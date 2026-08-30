import { describe, test, expect } from 'vitest';
import {
  jobStatusTone, jobStatusLabel, riskTone, riskLabel,
  isApproved, approvedNotAppliedNotice, supersededExplanation,
  canReadCorrelators, canEditConfig, canDecideConfig, isReservedCapability,
  queueHeadline, diffEntries,
  validationSummary, eligibilityLabel, eligibilityTone, planNoApplyNotice,
  applyGateLabel, applyGateTone,
  heartbeatLabel, heartbeatTone, queueStateLabel, applyReadinessLabel, applyReadinessTone,
} from './correlatorsView';
import type { DraftView, ValidationResult, ApplyPlan, WorkerHealth } from './correlatorsApi';

describe('jobStatus Töne + Labels', () => {
  test('superseded → warning, eigenes Label (kein Fehler)', () => {
    expect(jobStatusTone('superseded')).toBe('warning');
    expect(jobStatusLabel('superseded')).toBe('Ersetzt');
  });
  test('failed → danger, completed → success', () => {
    expect(jobStatusTone('failed')).toBe('danger');
    expect(jobStatusTone('completed')).toBe('success');
  });
  test('aktive Status → muted/accent', () => {
    expect(jobStatusTone('pending')).toBe('muted');
    expect(jobStatusTone('running')).toBe('accent');
  });
});

describe('riskTone + riskLabel', () => {
  test('Risiko-Töne', () => {
    expect(riskTone('low')).toBe('success');
    expect(riskTone('medium')).toBe('warning');
    expect(riskTone('high')).toBe('danger');
    expect(riskTone('prohibited')).toBe('danger');
  });
  test('Risiko-Labels (de)', () => {
    expect(riskLabel('low')).toBe('Niedrig');
    expect(riskLabel('prohibited')).toBe('Gesperrt');
  });
});

describe('approved ≠ applied', () => {
  const draft = (status: DraftView['status']): DraftView => ({
    id: 'd', capabilityId: 'c', targetId: 't', value: {}, status,
    version: 1, revision: 1, createdBy: 'x', createdAt: '', updatedAt: '',
  });
  test('isApproved nur bei status approved', () => {
    expect(isApproved(draft('approved'))).toBe(true);
    expect(isApproved(draft('pending_approval'))).toBe(false);
  });
  test('approvedNotAppliedNotice macht klar: genehmigt, nicht angewendet', () => {
    const txt = approvedNotAppliedNotice();
    expect(txt.toLowerCase()).toContain('genehmigt');
    expect(txt.toLowerCase()).toContain('nicht');
    expect(txt.toLowerCase()).toContain('angewendet');
  });
});

describe('supersededExplanation', () => {
  test('erklärt „durch neuere Ticket-Revision ersetzt", kein pauschaler Fehler', () => {
    const txt = supersededExplanation();
    expect(txt.toLowerCase()).toContain('revision');
    expect(txt.toLowerCase()).not.toContain('fehler');
  });
});

describe('RBAC-Sicht', () => {
  test('canRead = analyst+', () => {
    expect(canReadCorrelators('analyst')).toBe(true);
    expect(canReadCorrelators('viewer')).toBe(false);
  });
  test('canEditConfig = engineer+', () => {
    expect(canEditConfig('engineer')).toBe(true);
    expect(canEditConfig('analyst')).toBe(false);
  });
  test('canDecideConfig = admin', () => {
    expect(canDecideConfig('admin')).toBe(true);
    expect(canDecideConfig('engineer')).toBe(false);
  });
});

describe('isReservedCapability', () => {
  test('editable:false oder prohibited → reserviert', () => {
    expect(isReservedCapability({ editable: false, risk: 'low' })).toBe(true);
    expect(isReservedCapability({ editable: true, risk: 'prohibited' })).toBe(true);
    expect(isReservedCapability({ editable: true, risk: 'low' })).toBe(false);
  });
});

describe('queueHeadline', () => {
  test('fasst aktiv/abgeschlossen/fehlgeschlagen/ersetzt zusammen', () => {
    const txt = queueHeadline({ total: 9, active: 2, pending: 2, running: 0, retrying: 0, completed: 5, failed: 1, superseded: 1 });
    expect(txt).toContain('2');
    expect(txt.toLowerCase()).toContain('aktiv');
    expect(txt.toLowerCase()).toContain('ersetzt');
  });
});

describe('Validierung + Apply-Plan-Vorschau (kein Apply)', () => {
  const plan = (applyEligible: boolean, applyImpact: ApplyPlan['applyImpact'] = 'reload'): Pick<ApplyPlan, 'applyEligible' | 'applyImpact'> => ({ applyEligible, applyImpact });

  test('validationSummary fasst Erfolg/Fehler zusammen', () => {
    const ok: ValidationResult = { draftId: 'd', capabilityId: 'c', valid: true, value: {}, errors: [] };
    const bad: ValidationResult = { draftId: 'd', capabilityId: 'c', valid: false, value: null, errors: ['zu groß'] };
    expect(validationSummary(ok).toLowerCase()).toContain('erfolgreich');
    expect(validationSummary(bad)).toContain('zu groß');
  });

  test('eligibilityLabel/Tone unterscheiden apply-fähig vs. nicht anwendbar', () => {
    expect(eligibilityLabel(plan(true))).toMatch(/später/i);
    expect(eligibilityLabel(plan(false))).toMatch(/nicht anwendbar/i);
    expect(eligibilityTone(plan(true))).toBe('accent');
    expect(eligibilityTone(plan(false))).toBe('muted');
  });

  test('planNoApplyNotice macht klar: nichts wird angewendet + nennt Impact', () => {
    const txt = planNoApplyNotice(plan(true, 'restart'));
    expect(txt.toLowerCase()).toContain('nichts angewendet');
    expect(txt).toContain('restart');
  });

  test('applyGateLabel/Tone: not_supported → gesperrt, supported → freigegeben', () => {
    expect(applyGateLabel('not_supported')).toMatch(/gesperrt/i);
    expect(applyGateLabel('supported')).toMatch(/freigegeben/i);
    expect(applyGateTone('not_supported')).toBe('muted');
    expect(applyGateTone('supported')).toBe('warning');
  });
});

describe('Worker Live-Health (Stufe 3)', () => {
  const wh = (over: Partial<WorkerHealth> = {}): WorkerHealth => ({
    workerId: 'correlation-worker', present: true, lastHeartbeatAt: '', ageMs: 100, heartbeatFresh: true,
    adoptedConfigVersions: { 'correlator.worker.maxChildren': 3 }, queueProcessingState: 'idle', queueOk: true,
    lastJobOutcome: 'completed', killSwitchEnabled: false, applyReady: false, reasons: ['Apply serverseitig gesperrt'], ...over,
  });

  test('heartbeatLabel/Tone: present+fresh → frisch/success, !present → unbekannt/muted', () => {
    expect(heartbeatLabel(wh({ heartbeatFresh: true }))).toBe('frisch');
    expect(heartbeatTone(wh({ heartbeatFresh: true }))).toBe('success');
    expect(heartbeatLabel(wh({ present: false }))).toBe('unbekannt');
    expect(heartbeatLabel(wh({ present: true, heartbeatFresh: false }))).toBe('veraltet');
  });

  test('queueStateLabel mappt Zustände lesbar', () => {
    expect(queueStateLabel('processing')).toBe('verarbeitet');
    expect(queueStateLabel('stalled')).toBe('Stall');
  });

  test('applyReadinessLabel: blockiert nennt Gründe; ready nennt alle Signale da', () => {
    expect(applyReadinessLabel(wh({ applyReady: false, reasons: ['Apply serverseitig gesperrt'] }))).toMatch(/blockiert/i);
    expect(applyReadinessLabel(wh({ applyReady: true, reasons: [] }))).toMatch(/Apply-Ready/i);
    expect(applyReadinessTone(wh({ applyReady: false }))).toBe('muted');
  });
});

describe('diffEntries (redigierter Vorher/Nachher-Diff)', () => {
  test('listet geänderte Felder, behält redaction bei', () => {
    const entries = diffEntries({ maxChildren: 200 }, { maxChildren: 300 });
    expect(entries).toEqual([{ key: 'maxChildren', before: 200, after: 300 }]);
  });
  test('null before → reine Anlage', () => {
    const entries = diffEntries(null, { maxRetries: 3 });
    expect(entries).toEqual([{ key: 'maxRetries', before: undefined, after: 3 }]);
  });
});
