import { describe, it, expect } from 'vitest';
import {
  KI_ANALYSIS_FUNCTIONS,
  enabledKiFunctions,
  disabledKiFunctions,
} from './kiAnalysisFunctions';

describe('KI_ANALYSIS_FUNCTIONS', () => {
  it('hat genau 9 Einträge (9 aktiv + 0 geplant)', () => {
    expect(KI_ANALYSIS_FUNCTIONS).toHaveLength(9);
  });

  it('hat genau 9 aktivierte Funktionen (alle live)', () => {
    expect(enabledKiFunctions()).toHaveLength(9);
  });

  it('hat keine deaktivierten (geplanten) Funktionen mehr', () => {
    expect(disabledKiFunctions()).toHaveLength(0);
  });

  it('alle aktivierten Funktionen haben eine kind-Zuordnung', () => {
    enabledKiFunctions().forEach((fn) => {
      expect(fn.kind).toBeTruthy();
      expect(typeof fn.kind).toBe('string');
    });
  });

  it('die 6 ursprünglichen Kinds sind weiterhin enthalten', () => {
    const kinds = enabledKiFunctions().map((f) => f.kind);
    expect(kinds).toContain('triage');
    expect(kinds).toContain('false_positive_review');
    expect(kinds).toContain('incident_recommendation');
    expect(kinds).toContain('hunt_suggestion');
    expect(kinds).toContain('report_draft');
    expect(kinds).toContain('customer_response');
  });

  it('die 3 neuen Kinds sind jetzt aktiviert', () => {
    const kinds = enabledKiFunctions().map((f) => f.kind);
    expect(kinds).toContain('evidence_explanation');
    expect(kinds).toContain('mitre_mapping');
    expect(kinds).toContain('next_steps');
  });

  it('jeder Eintrag hat ein label', () => {
    KI_ANALYSIS_FUNCTIONS.forEach((fn) => {
      expect(fn.label).toBeTruthy();
    });
  });

  it('jeder Eintrag hat eine description', () => {
    KI_ANALYSIS_FUNCTIONS.forEach((fn) => {
      expect(fn.description).toBeTruthy();
    });
  });

  it('Evidence Explanation hat kind evidence_explanation und enabled=true', () => {
    const fn = KI_ANALYSIS_FUNCTIONS.find((f) => f.label === 'Evidence Explanation');
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe('evidence_explanation');
    expect(fn?.enabled).toBe(true);
  });

  it('MITRE Mapping hat kind mitre_mapping und enabled=true', () => {
    const fn = KI_ANALYSIS_FUNCTIONS.find((f) => f.label === 'MITRE Mapping');
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe('mitre_mapping');
    expect(fn?.enabled).toBe(true);
  });

  it('Next Steps hat kind next_steps und enabled=true', () => {
    const fn = KI_ANALYSIS_FUNCTIONS.find((f) => f.label === 'Next Steps');
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe('next_steps');
    expect(fn?.enabled).toBe(true);
  });
});
