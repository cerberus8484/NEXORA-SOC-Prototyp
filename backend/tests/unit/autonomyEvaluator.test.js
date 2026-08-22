'use strict';

/**
 * Tests — AutonomyEvaluator
 * Reine Funktion, keine Seiteneffekte.
 * Default-Deny + Decken müssen durch Tests belegt sein.
 */

const { decide } = require('../../src/services/AutonomyEvaluator');

// ─── Hilfsfunktion ────────────────────────────────────────────────────────────

function happyPath(overrides = {}) {
  return {
    policy: {
      enabled:              true,
      mode:                 'autonomous',
      actionClass:          'enrichment',
      minVerdict:           'suspicious',
      minConfidence:        0.7,
      requireEvidenceFloor: true,
      maxPerHour:           0,
    },
    actionClass:      'enrichment',
    verdict:          'confirmed_incident',
    confidence:       0.9,
    evidenceBacked:   true,
    globalEnabled:    true,
    recentActionCount: 0,
    ...overrides,
  };
}

// ─── Kill-Switch (globalEnabled) ──────────────────────────────────────────────

describe('AutonomyEvaluator — Kill-Switch', () => {
  it('globalEnabled=false → advise, egal wie Policy konfiguriert ist', () => {
    const result = decide(happyPath({ globalEnabled: false }));
    expect(result.decision).toBe('advise');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('globalEnabled=undefined → advise', () => {
    const result = decide(happyPath({ globalEnabled: undefined }));
    expect(result.decision).toBe('advise');
  });

  it('globalEnabled=null → advise', () => {
    const result = decide(happyPath({ globalEnabled: null }));
    expect(result.decision).toBe('advise');
  });
});

// ─── Policy-Checks ────────────────────────────────────────────────────────────

describe('AutonomyEvaluator — Policy-Checks', () => {
  it('kein policy-Objekt → advise', () => {
    const result = decide(happyPath({ policy: null }));
    expect(result.decision).toBe('advise');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('policy.enabled=false → advise', () => {
    const result = decide(happyPath({
      policy: { ...happyPath().policy, enabled: false },
    }));
    expect(result.decision).toBe('advise');
  });
});

// ─── Decken (CEILINGS) ────────────────────────────────────────────────────────

describe('AutonomyEvaluator — Decken', () => {
  it('host_response mit mode=autonomous → advise (Decke = advisory)', () => {
    const result = decide(happyPath({
      actionClass: 'host_response',
      policy: { ...happyPath().policy, mode: 'autonomous', actionClass: 'host_response' },
    }));
    expect(result.decision).toBe('advise');
    expect(result.reasons.some(r => r.includes('ceiling') || r.includes('Decke') || r.includes('mode'))).toBe(true);
  });

  it('external_comms mit mode=autonomous → advise (Decke = advisory)', () => {
    const result = decide(happyPath({
      actionClass: 'external_comms',
      policy: { ...happyPath().policy, mode: 'autonomous', actionClass: 'external_comms' },
    }));
    expect(result.decision).toBe('advise');
  });

  it('detection_write mit mode=autonomous → advise (Decke = assisted)', () => {
    const result = decide(happyPath({
      actionClass: 'detection_write',
      policy: { ...happyPath().policy, mode: 'autonomous', actionClass: 'detection_write' },
    }));
    expect(result.decision).toBe('advise');
  });

  it('host_response darf NIEMALS act sein, selbst wenn alles grün', () => {
    const result = decide({
      policy: {
        enabled:              true,
        mode:                 'autonomous',
        actionClass:          'host_response',
        minVerdict:           'suspicious',
        minConfidence:        0.5,
        requireEvidenceFloor: false,
        maxPerHour:           0,
      },
      actionClass:      'host_response',
      verdict:          'confirmed_incident',
      confidence:       1.0,
      evidenceBacked:   true,
      globalEnabled:    true,
      recentActionCount: 0,
    });
    expect(result.decision).toBe('advise');
  });

  it('external_comms darf NIEMALS act sein, selbst wenn alles grün', () => {
    const result = decide({
      policy: {
        enabled:              true,
        mode:                 'autonomous',
        actionClass:          'external_comms',
        minVerdict:           'suspicious',
        minConfidence:        0.5,
        requireEvidenceFloor: false,
        maxPerHour:           0,
      },
      actionClass:      'external_comms',
      verdict:          'confirmed_incident',
      confidence:       1.0,
      evidenceBacked:   true,
      globalEnabled:    true,
      recentActionCount: 0,
    });
    expect(result.decision).toBe('advise');
  });

  it('enrichment mit mode=advisory → advise (effectiveMode = advisory, kein act)', () => {
    const result = decide(happyPath({
      policy: { ...happyPath().policy, mode: 'advisory' },
    }));
    expect(result.decision).toBe('advise');
  });

  it('enrichment mit mode=assisted → advise (effectiveMode = assisted, kein act)', () => {
    const result = decide(happyPath({
      policy: { ...happyPath().policy, mode: 'assisted' },
    }));
    expect(result.decision).toBe('advise');
  });
});

// ─── Evidence-Floor ───────────────────────────────────────────────────────────

describe('AutonomyEvaluator — Evidence-Floor', () => {
  it('requireEvidenceFloor=true + evidenceBacked=false → advise', () => {
    const result = decide(happyPath({ evidenceBacked: false }));
    expect(result.decision).toBe('advise');
  });

  it('requireEvidenceFloor=false + evidenceBacked=false → kein advise wegen Evidence', () => {
    // alle anderen Bedingungen erfüllt → sollte act sein
    const result = decide(happyPath({
      evidenceBacked: false,
      policy: { ...happyPath().policy, requireEvidenceFloor: false },
    }));
    expect(result.decision).toBe('act');
  });

  it('requireEvidenceFloor=true + evidenceBacked=true → kein advise wegen Evidence', () => {
    // alle anderen Bedingungen erfüllt → act
    const result = decide(happyPath({ evidenceBacked: true }));
    expect(result.decision).toBe('act');
  });
});

// ─── Verdict-Rang ─────────────────────────────────────────────────────────────

describe('AutonomyEvaluator — Verdict-Rang', () => {
  it('verdict=needs_more_info (Rang 0) unter minVerdict=suspicious (Rang 1) → advise', () => {
    const result = decide(happyPath({
      verdict:    'needs_more_info',
      policy: { ...happyPath().policy, minVerdict: 'suspicious' },
    }));
    expect(result.decision).toBe('advise');
  });

  it('verdict=false_positive (Rang 0) unter minVerdict=suspicious (Rang 1) → advise', () => {
    const result = decide(happyPath({
      verdict:    'false_positive',
      policy: { ...happyPath().policy, minVerdict: 'suspicious' },
    }));
    expect(result.decision).toBe('advise');
  });

  it('verdict=suspicious (Rang 1) >= minVerdict=suspicious (Rang 1) → kein advise wegen Verdict', () => {
    const result = decide(happyPath({
      verdict:    'suspicious',
      policy: { ...happyPath().policy, minVerdict: 'suspicious' },
    }));
    expect(result.decision).toBe('act');
  });

  it('verdict=confirmed_incident (Rang 2) >= minVerdict=suspicious (Rang 1) → kein advise wegen Verdict', () => {
    const result = decide(happyPath({
      verdict:    'confirmed_incident',
      policy: { ...happyPath().policy, minVerdict: 'suspicious' },
    }));
    expect(result.decision).toBe('act');
  });
});

// ─── Confidence ───────────────────────────────────────────────────────────────

describe('AutonomyEvaluator — Confidence', () => {
  it('confidence unter minConfidence → advise', () => {
    const result = decide(happyPath({
      confidence: 0.6,
      policy: { ...happyPath().policy, minConfidence: 0.7 },
    }));
    expect(result.decision).toBe('advise');
  });

  it('confidence gleich minConfidence → kein advise wegen Confidence', () => {
    const result = decide(happyPath({
      confidence: 0.7,
      policy: { ...happyPath().policy, minConfidence: 0.7 },
    }));
    expect(result.decision).toBe('act');
  });

  it('confidence über minConfidence → kein advise wegen Confidence', () => {
    const result = decide(happyPath({
      confidence: 0.95,
      policy: { ...happyPath().policy, minConfidence: 0.7 },
    }));
    expect(result.decision).toBe('act');
  });
});

// ─── Rate-Limit / Circuit-Breaker ─────────────────────────────────────────────

describe('AutonomyEvaluator — Rate-Limit', () => {
  it('maxPerHour=0 → kein Rate-Limit (kein advise wegen Rate)', () => {
    const result = decide(happyPath({
      recentActionCount: 9999,
      policy: { ...happyPath().policy, maxPerHour: 0 },
    }));
    expect(result.decision).toBe('act');
  });

  it('maxPerHour=5, recentActionCount=4 → kein advise wegen Rate', () => {
    const result = decide(happyPath({
      recentActionCount: 4,
      policy: { ...happyPath().policy, maxPerHour: 5 },
    }));
    expect(result.decision).toBe('act');
  });

  it('maxPerHour=5, recentActionCount=5 → advise (Limit erreicht)', () => {
    const result = decide(happyPath({
      recentActionCount: 5,
      policy: { ...happyPath().policy, maxPerHour: 5 },
    }));
    expect(result.decision).toBe('advise');
  });

  it('maxPerHour=5, recentActionCount=10 → advise (Limit überschritten)', () => {
    const result = decide(happyPath({
      recentActionCount: 10,
      policy: { ...happyPath().policy, maxPerHour: 5 },
    }));
    expect(result.decision).toBe('advise');
  });
});

// ─── Happy Path (act) ─────────────────────────────────────────────────────────

describe('AutonomyEvaluator — Happy Path', () => {
  it('enrichment, autonomous, enabled, globalEnabled, evidenceBacked, verdict≥min, conf≥min → act', () => {
    const result = decide(happyPath());
    expect(result.decision).toBe('act');
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('act-Ergebnis enthält stets reasons-Array', () => {
    const result = decide(happyPath());
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('reasons');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('internal_state, autonomous, alle Bedingungen → act', () => {
    const result = decide(happyPath({
      actionClass: 'internal_state',
      policy: { ...happyPath().policy, mode: 'autonomous', actionClass: 'internal_state' },
    }));
    expect(result.decision).toBe('act');
  });

  it('draft_generation, autonomous, alle Bedingungen → act', () => {
    const result = decide(happyPath({
      actionClass: 'draft_generation',
      policy: { ...happyPath().policy, mode: 'autonomous', actionClass: 'draft_generation' },
    }));
    expect(result.decision).toBe('act');
  });
});

// ─── reasons niemals leer / kein stiller Pfad ─────────────────────────────────

describe('AutonomyEvaluator — reasons immer befüllt', () => {
  it('advise-Entscheidung hat immer mind. einen Grund', () => {
    const cases = [
      happyPath({ globalEnabled: false }),
      happyPath({ policy: null }),
      happyPath({ policy: { ...happyPath().policy, enabled: false } }),
      happyPath({ actionClass: 'host_response', policy: { ...happyPath().policy, actionClass: 'host_response' } }),
      happyPath({ evidenceBacked: false }),
      happyPath({ verdict: 'needs_more_info' }),
      happyPath({ confidence: 0.1 }),
    ];
    cases.forEach((c) => {
      const r = decide(c);
      if (r.decision === 'advise') {
        expect(r.reasons.length).toBeGreaterThan(0);
      }
    });
  });

  it('act-Entscheidung hat ebenfalls reasons (kein stiller Pfad)', () => {
    const result = decide(happyPath());
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
