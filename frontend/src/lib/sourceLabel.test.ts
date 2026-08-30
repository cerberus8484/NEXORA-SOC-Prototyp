import { describe, it, expect } from 'vitest';
import { sourceLabel, isCorrelatedSource } from './sourceLabel';

describe('sourceLabel', () => {
  it('mappt bekannte Quellen auf lesbare Labels', () => {
    expect(sourceLabel('wazuh')).toBe('Wazuh');
    expect(sourceLabel('qradar')).toBe('QRadar');
    expect(sourceLabel('dataplane')).toBe('Korrelierter Vorfall');
    expect(sourceLabel('email')).toBe('E-Mail');
  });

  it('ist case-insensitiv und trimmt', () => {
    expect(sourceLabel('  DataPlane ')).toBe('Korrelierter Vorfall');
  });

  it('leer/null → Manuell', () => {
    expect(sourceLabel('')).toBe('Manuell');
    expect(sourceLabel(null)).toBe('Manuell');
    expect(sourceLabel(undefined)).toBe('Manuell');
  });

  it('unbekannte Quelle → unverändert (kein Verlust)', () => {
    expect(sourceLabel('wazuh_indexer')).toBe('wazuh_indexer');
  });
});

describe('isCorrelatedSource', () => {
  it('erkennt den Data-Plane-Cross-Domain-Vorfall', () => {
    expect(isCorrelatedSource('dataplane')).toBe(true);
    expect(isCorrelatedSource(' DATAPLANE ')).toBe(true);
    expect(isCorrelatedSource('wazuh')).toBe(false);
    expect(isCorrelatedSource(null)).toBe(false);
  });
});
