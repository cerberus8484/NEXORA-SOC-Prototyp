import { describe, it, expect } from 'vitest';
import { MITRE_MATRIX, normalizeTechniqueId, buildCoverageSet, buildCombinedCoverageSet } from './mitreModel';

describe('normalizeTechniqueId', () => {
  it('gibt Stamm-ID zurück (ohne Sub-Technik)', () => {
    expect(normalizeTechniqueId('T1059.001')).toBe('T1059');
  });
  it('lässt einfache IDs unverändert', () => {
    expect(normalizeTechniqueId('T1078')).toBe('T1078');
  });
  it('normalisiert zu Großbuchstaben', () => {
    expect(normalizeTechniqueId('t1059')).toBe('T1059');
  });
});

describe('buildCoverageSet', () => {
  it('gibt leeres Set für leere Liste zurück', () => {
    expect(buildCoverageSet([])).toEqual(new Set());
  });
  it('normalisiert Sub-Techniken auf Stamm', () => {
    const s = buildCoverageSet(['T1059.001', 'T1078']);
    expect(s.has('T1059')).toBe(true);
    expect(s.has('T1078')).toBe(true);
  });
  it('dedupliziert', () => {
    const s = buildCoverageSet(['T1059', 'T1059.001', 'T1059.003']);
    expect(s.size).toBe(1);
  });
});

describe('buildCombinedCoverageSet', () => {
  it('vereint Regel-IDs und Hunt-Katalog-Technik-IDs', () => {
    const s = buildCombinedCoverageSet(['T1059.001'], [{ mitre: 'T1078' }, { mitre: 'T1486' }]);
    expect(s.has('T1059')).toBe(true);
    expect(s.has('T1078')).toBe(true);
    expect(s.has('T1486')).toBe(true);
  });
  it('ignoriert Hunts ohne MITRE-ID (FP-/Exposure-Hunts)', () => {
    const s = buildCombinedCoverageSet([], [{ mitre: '' }, { mitre: 'T1003.006' }]);
    expect(s.has('T1003')).toBe(true);
    expect(s.size).toBe(1);
  });
  it('dedupliziert über beide Quellen hinweg (Regel + Hunt auf gleiche Technik)', () => {
    const s = buildCombinedCoverageSet(['T1110'], [{ mitre: 'T1110.001' }]);
    expect(s.size).toBe(1);
    expect(s.has('T1110')).toBe(true);
  });
});

describe('MITRE_MATRIX', () => {
  it('enthält 12 Taktiken', () => {
    expect(MITRE_MATRIX.length).toBe(12);
  });
  it('jede Taktik hat mindestens 3 Techniken', () => {
    for (const tactic of MITRE_MATRIX) {
      expect(tactic.techniques.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('alle Technik-IDs beginnen mit T', () => {
    for (const tactic of MITRE_MATRIX) {
      for (const tech of tactic.techniques) {
        expect(tech.id).toMatch(/^T\d{4}/);
      }
    }
  });
});
