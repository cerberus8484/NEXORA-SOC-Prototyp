// TDD: Transform-Helfer für die Dashboard-Card "Top Erkennungsquellen".
// Reine Logik (kein JSX, kein DOM, kein Buffer / @types/node).

import { describe, test, expect } from 'vitest';
import {
  humanizeRuleKey,
  buildDetectionSources,
  type DetectionSource,
} from './detectionSourcesModel';

// ── humanizeRuleKey ───────────────────────────────────────────────────────────

describe('humanizeRuleKey', () => {
  test('mappt "rule:100205" auf "Regel 100205"', () => {
    expect(humanizeRuleKey('rule:100205')).toBe('Regel 100205');
  });

  test('mappt reine numerische ID "12345" auf "Regel 12345"', () => {
    expect(humanizeRuleKey('12345')).toBe('Regel 12345');
  });

  test('ignoriert Suffix bei "rule:100205:agent:win10"', () => {
    expect(humanizeRuleKey('rule:100205:agent:win10')).toBe('Regel 100205');
  });

  test('gibt unbekanntes Format unverändert zurück (keine Erfindung)', () => {
    expect(humanizeRuleKey('custom-source')).toBe('custom-source');
  });

  test('leerer String → "(unbekannt)"', () => {
    expect(humanizeRuleKey('')).toBe('(unbekannt)');
  });

  test('trimmt Whitespace vor dem Mapping', () => {
    expect(humanizeRuleKey('  rule:42  ')).toBe('Regel 42');
  });
});

// ── buildDetectionSources ─────────────────────────────────────────────────────

describe('buildDetectionSources', () => {
  test('null/undefined Eingabe → leeres Array (ehrlicher Leerzustand)', () => {
    expect(buildDetectionSources(null)).toEqual([]);
    expect(buildDetectionSources(undefined)).toEqual([]);
  });

  test('leeres Array → leeres Array', () => {
    expect(buildDetectionSources([])).toEqual([]);
  });

  test('sortiert absteigend nach count', () => {
    const input: DetectionSource[] = [
      { key: 'rule:1', count: 2 },
      { key: 'rule:2', count: 9 },
      { key: 'rule:3', count: 5 },
    ];
    const rows = buildDetectionSources(input);
    expect(rows.map((r) => r.count)).toEqual([9, 5, 2]);
    expect(rows.map((r) => r.key)).toEqual(['rule:2', 'rule:3', 'rule:1']);
  });

  test('humanisiert die Labels', () => {
    const rows = buildDetectionSources([{ key: 'rule:100205', count: 3 }]);
    expect(rows[0]).toEqual({ key: 'rule:100205', label: 'Regel 100205', count: 3 });
  });

  test('kappt auf default Top-5', () => {
    const input: DetectionSource[] = Array.from({ length: 8 }, (_, i) => ({
      key: `rule:${i}`,
      count: i + 1,
    }));
    const rows = buildDetectionSources(input);
    expect(rows).toHaveLength(5);
    // höchste counts zuerst: 8,7,6,5,4
    expect(rows.map((r) => r.count)).toEqual([8, 7, 6, 5, 4]);
  });

  test('respektiert eigenen topN-Parameter', () => {
    const input: DetectionSource[] = [
      { key: 'rule:1', count: 3 },
      { key: 'rule:2', count: 2 },
      { key: 'rule:3', count: 1 },
    ];
    expect(buildDetectionSources(input, 2)).toHaveLength(2);
  });

  test('filtert Einträge mit count <= 0', () => {
    const input: DetectionSource[] = [
      { key: 'rule:1', count: 0 },
      { key: 'rule:2', count: 4 },
      { key: 'rule:3', count: -1 },
    ];
    const rows = buildDetectionSources(input);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('rule:2');
  });

  test('mutiert die Eingabe nicht (Immutabilität)', () => {
    const input: DetectionSource[] = [
      { key: 'rule:1', count: 1 },
      { key: 'rule:2', count: 9 },
    ];
    const snapshot = JSON.stringify(input);
    buildDetectionSources(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
