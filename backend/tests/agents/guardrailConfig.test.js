'use strict';

const { EVIDENCE_FLOOR, BENIGN_FLOOR, describeGuardrails } = require('../../src/agents/guardrailConfig');

describe('guardrailConfig — Konstanten spiegeln die echten Floor-Schwellen', () => {
  it('EVIDENCE_FLOOR enthält die VT-Schwellen 5/1 und Confidence 0.9/0.7', () => {
    expect(EVIDENCE_FLOOR.confirmedVtMin).toBe(5);
    expect(EVIDENCE_FLOOR.suspiciousVtMin).toBe(1);
    expect(EVIDENCE_FLOOR.confirmedConfidenceFloor).toBe(0.9);
    expect(EVIDENCE_FLOOR.suspiciousConfidenceFloor).toBe(0.7);
  });

  it('BENIGN_FLOOR confidenceFloor ist 0.8', () => {
    expect(BENIGN_FLOOR.confidenceFloor).toBe(0.8);
  });

  it('Konstanten sind eingefroren (keine versehentliche Drift zur Laufzeit)', () => {
    expect(Object.isFrozen(EVIDENCE_FLOOR)).toBe(true);
    expect(Object.isFrozen(BENIGN_FLOOR)).toBe(true);
  });
});

describe('describeGuardrails() — read-only Transparenz-Objekt', () => {
  it('spiegelt die Evidence-Floor-Werte 1:1 aus den Konstanten', () => {
    const g = describeGuardrails();
    expect(g.evidenceFloor).toEqual({
      enabled: true,
      confirmedVtMin: 5,
      suspiciousVtMin: 1,
      confirmedConfidenceFloor: 0.9,
      suspiciousConfidenceFloor: 0.7,
    });
  });

  it('spiegelt Benign-Floor + Anti-Halluzination + Human-in-the-Loop', () => {
    const g = describeGuardrails();
    expect(g.benignFloor).toEqual({ enabled: true, confidenceFloor: 0.8 });
    expect(g.antiHallucination).toEqual({ enabled: true });
    expect(g.humanInTheLoop.allSuggestionsRequireApproval).toBe(true);
    // autonomyEnabled aus Config (Default false ohne ENV).
    expect(typeof g.humanInTheLoop.autonomyEnabled).toBe('boolean');
  });

  it('autonomyEnabled folgt der Config (Default false)', () => {
    const g = describeGuardrails();
    // ohne AUTONOMY_ENABLED=true im Test-Env → false
    expect(g.humanInTheLoop.autonomyEnabled).toBe(false);
  });
});
