'use strict';

// P_CORR_ADMIN_2 Stufe 1 — reine Validierung + redigiertes Apply-Plan-Artefakt.
// KEIN echter Apply: applyStatus bleibt 'not_supported', wouldApply ist immer false.
// Apply-Eligibility ist eine EIGENE, engere Allowlist (nur 2 Worker-Parameter).

const { getCapability, isApplyEligible, APPLY_ELIGIBLE_CAPABILITY_IDS } = require('../../src/configRegistry/configCapabilityCatalog');
const { validateValue, buildApplyPlan, defaultsOf } = require('../../src/configRegistry/applyPlan');

describe('Apply-Eligibility-Allowlist (eigene, engere Liste)', () => {
  test('genau die zwei Worker-Parameter sind apply-eligible', () => {
    expect(isApplyEligible('correlator.worker.maxChildren')).toBe(true);
    expect(isApplyEligible('correlator.worker.maxRetries')).toBe(true);
    expect([...APPLY_ELIGIBLE_CAPABILITY_IDS].sort()).toEqual([
      'correlator.worker.maxChildren', 'correlator.worker.maxRetries',
    ]);
  });

  test('Host-/Netz-/Firewall-/Collector-/Integration-Capabilities sind NICHT eligible', () => {
    for (const id of [
      'host.network.allowlist', 'collector.firewall.maxLineBytes',
      'collector.firewall.maxLinesPerSecond', 'integration.virustotal.pollIntervalSeconds',
      'integration.notify.targetRef', 'service.api.requestLogLevel',
    ]) expect(isApplyEligible(id)).toBe(false);
  });

  test('Eligibility ändert NICHTS am applyStatus (bleibt not_supported)', () => {
    expect(getCapability('correlator.worker.maxChildren').toJSON().applyStatus).toBe('not_supported');
    expect(getCapability('correlator.worker.maxChildren').toJSON().applyEligible).toBe(true);
  });
});

describe('validateValue — separate, nicht-werfende Validierung', () => {
  const cap = getCapability('correlator.worker.maxChildren');

  test('gültiger Wert → valid:true + normalisierter Wert', () => {
    const res = validateValue(cap, { maxChildren: 42 });
    expect(res.valid).toBe(true);
    expect(res.value).toEqual({ maxChildren: 42 });
    expect(res.errors).toEqual([]);
  });

  test('out-of-range → valid:false + Fehlermeldung, ohne Exception', () => {
    const res = validateValue(cap, { maxChildren: 99999 });
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  test('sensibles Feld wird im Validierungsergebnis redigiert', () => {
    const notify = getCapability('integration.notify.targetRef');
    const res = validateValue(notify, { targetRef: 'channel://ops-secret' });
    expect(res.valid).toBe(true);
    expect(JSON.stringify(res)).not.toContain('ops-secret');
  });
});

describe('buildApplyPlan — redigiertes Artefakt, KEIN Apply', () => {
  const cap = getCapability('correlator.worker.maxChildren');

  test('Plan markiert wouldApply:false + applyStatus not_supported', () => {
    const plan = buildApplyPlan({ capability: cap, targetId: 'correlation-worker', before: { maxChildren: 200 }, after: { maxChildren: 300 } });
    expect(plan.wouldApply).toBe(false);
    expect(plan.applyStatus).toBe('not_supported');
    expect(plan.applyImpact).toBe('reload');
    expect(plan.applyEligible).toBe(true);
  });

  test('changes listet geänderte Felder, unchanged die gleich gebliebenen', () => {
    const plan = buildApplyPlan({ capability: cap, targetId: 'correlation-worker', before: { maxChildren: 200 }, after: { maxChildren: 200 } });
    expect(plan.changes).toEqual([]);
    expect(plan.unchanged).toEqual([{ key: 'maxChildren', value: 200 }]);
  });

  test('nicht-eligible Capability → applyEligible:false (sichtbar, aber nie anwendbar)', () => {
    const fw = getCapability('collector.firewall.maxLineBytes');
    const plan = buildApplyPlan({ capability: fw, targetId: 'firewall-collector', before: { maxLineBytes: 8192 }, after: { maxLineBytes: 4096 } });
    expect(plan.applyEligible).toBe(false);
    expect(plan.wouldApply).toBe(false);
  });

  test('redigiert sensible Felder in before/after', () => {
    const notify = getCapability('integration.notify.targetRef');
    const plan = buildApplyPlan({ capability: notify, targetId: 'notify', before: { targetRef: 'channel://old-secret' }, after: { targetRef: 'channel://new-secret' } });
    expect(JSON.stringify(plan)).not.toContain('old-secret');
    expect(JSON.stringify(plan)).not.toContain('new-secret');
  });
});

describe('defaultsOf — Baseline aus Capability-Defaults', () => {
  test('liefert die Default-Werte als Baseline (kein angewendeter Wert existiert)', () => {
    const cap = getCapability('correlator.worker.maxRetries');
    expect(defaultsOf(cap)).toEqual({ maxRetries: 3 });
  });
});
