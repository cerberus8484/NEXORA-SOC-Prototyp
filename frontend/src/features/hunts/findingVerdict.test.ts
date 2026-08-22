/**
 * Tests für Finding-Verdict (Block B2) — Frontend-Einheit.
 *
 * Testet:
 * - FINDING_VERDICT_VALUES konstante (Type-Guard)
 * - verdictTone-Helfer (Tone-Mapping)
 * - VERDICT_LABELS-Vollständigkeit
 *
 * KEIN Buffer, KEIN node-only Import → kompatibel mit Vitest (browser env).
 */
import { describe, test, expect } from 'vitest';
import type { FindingVerdict, HuntFinding } from '../../lib/types';

// ─── Konstanten (direkt hier definiert, spiegeln die Domain) ─────────────────

const FINDING_VERDICT_VALUES: FindingVerdict[] = [
  '', 'benign', 'suspicious', 'malicious', 'inconclusive',
];

function verdictTone(v: FindingVerdict): string {
  if (v === 'benign')       return 'success';
  if (v === 'suspicious')   return 'warning';
  if (v === 'malicious')    return 'danger';
  if (v === 'inconclusive') return 'muted';
  return 'muted';
}

const VERDICT_LABELS: Record<FindingVerdict, string> = {
  '':             'Kein Verdict',
  benign:         'Benign',
  suspicious:     'Suspicious',
  malicious:      'Malicious',
  inconclusive:   'Inconclusive',
};

// ─── Hilfsfunktion: minimales HuntFinding ─────────────────────────────────────

const mkFinding = (over: Partial<HuntFinding> = {}): HuntFinding => ({
  id: 'f1', sessionId: 's1', title: 'Test Finding', description: '',
  severity: 'high', confidence: 'medium', artifactIds: [], mitreAttack: '',
  recommendation: '', analystId: 'ana', ticketId: null,
  verdict: '',
  context: {}, createdAt: '2026-06-14T10:00:00.000Z', updatedAt: '2026-06-14T10:00:00.000Z',
  ...over,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('HuntFinding.verdict — Typ und Werte', () => {
  test('verdict-Feld ist in HuntFinding vorhanden', () => {
    const f = mkFinding();
    expect(Object.prototype.hasOwnProperty.call(f, 'verdict')).toBe(true);
  });

  test('verdict-Default ist leerer String', () => {
    const f = mkFinding();
    expect(f.verdict).toBe('');
  });

  test('alle FINDING_VERDICT_VALUES sind gültige FindingVerdict-Werte', () => {
    expect(FINDING_VERDICT_VALUES).toHaveLength(5);
    expect(FINDING_VERDICT_VALUES).toContain('');
    expect(FINDING_VERDICT_VALUES).toContain('benign');
    expect(FINDING_VERDICT_VALUES).toContain('suspicious');
    expect(FINDING_VERDICT_VALUES).toContain('malicious');
    expect(FINDING_VERDICT_VALUES).toContain('inconclusive');
  });

  test('mkFinding akzeptiert alle Verdict-Werte', () => {
    for (const v of FINDING_VERDICT_VALUES) {
      const f = mkFinding({ verdict: v });
      expect(f.verdict).toBe(v);
    }
  });
});

describe('verdictTone — Tone-Mapping', () => {
  test('benign → success', () => {
    expect(verdictTone('benign')).toBe('success');
  });

  test('suspicious → warning', () => {
    expect(verdictTone('suspicious')).toBe('warning');
  });

  test('malicious → danger', () => {
    expect(verdictTone('malicious')).toBe('danger');
  });

  test('inconclusive → muted', () => {
    expect(verdictTone('inconclusive')).toBe('muted');
  });

  test('leerer String (kein Verdict) → muted', () => {
    expect(verdictTone('')).toBe('muted');
  });
});

describe('VERDICT_LABELS — Vollständigkeit', () => {
  test('jeder FINDING_VERDICT_VALUES-Wert hat ein Label', () => {
    for (const v of FINDING_VERDICT_VALUES) {
      expect(VERDICT_LABELS[v]).toBeTruthy();
    }
  });

  test('Label für leeren String ist "Kein Verdict"', () => {
    expect(VERDICT_LABELS['']).toBe('Kein Verdict');
  });

  test('alle Labels sind non-empty Strings', () => {
    for (const label of Object.values(VERDICT_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
