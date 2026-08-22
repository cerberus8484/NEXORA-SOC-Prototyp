import { describe, it, expect } from 'vitest';
import { rangeToSince, RANGE_OPTIONS, DEFAULT_RANGE, type MetricsRange } from './metricsRange';

const NOW = new Date('2026-07-01T12:00:00.000Z');

describe('rangeToSince', () => {
  it('all → null (kein Zeitraumfilter)', () => {
    expect(rangeToSince('all', NOW)).toBeNull();
  });

  it('7d → genau 7 Tage vor now (ISO)', () => {
    expect(rangeToSince('7d', NOW)).toBe('2026-06-24T12:00:00.000Z');
  });

  it('30d → 30 Tage vor now', () => {
    expect(rangeToSince('30d', NOW)).toBe('2026-06-01T12:00:00.000Z');
  });

  it('90d → 90 Tage vor now', () => {
    expect(rangeToSince('90d', NOW)).toBe('2026-04-02T12:00:00.000Z');
  });

  it('nutzt new Date() als Default wenn now nicht übergeben', () => {
    const before = Date.now();
    const iso = rangeToSince('7d');
    const after = Date.now();
    expect(iso).not.toBeNull();
    const ms = Date.parse(iso as string);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(ms).toBeGreaterThanOrEqual(before - sevenDays - 1000);
    expect(ms).toBeLessThanOrEqual(after - sevenDays + 1000);
  });
});

describe('RANGE_OPTIONS + DEFAULT_RANGE', () => {
  it('enthält alle vier Zeiträume in fester Reihenfolge', () => {
    expect(RANGE_OPTIONS.map((o) => o.value)).toEqual<MetricsRange[]>(['7d', '30d', '90d', 'all']);
  });

  it('Default ist ein gültiger Zeitraum', () => {
    expect(RANGE_OPTIONS.map((o) => o.value)).toContain(DEFAULT_RANGE);
  });

  it('jede Option hat ein nicht-leeres Label', () => {
    for (const o of RANGE_OPTIONS) expect(o.label.length).toBeGreaterThan(0);
  });
});
