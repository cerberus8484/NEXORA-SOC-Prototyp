import { describe, it, expect } from 'vitest';
import { percent, donutArcs } from './donut';

describe('percent', () => {
  it('total 0 → 0 (kein NaN/Division durch 0)', () => {
    expect(percent(5, 0)).toBe(0);
  });
  it('rundet kaufmännisch', () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
  });
});

describe('donutArcs', () => {
  it('leere Werte → leere Bögen', () => {
    expect(donutArcs([], 100)).toEqual([]);
  });

  it('alle Werte 0 → keine Füllung', () => {
    const arcs = donutArcs([0, 0], 100);
    expect(arcs.every((a) => a.dash === 0)).toBe(true);
  });

  it('zwei gleiche Segmente → 50/50 mit kumulativem Offset', () => {
    const arcs = donutArcs([1, 1], 100);
    expect(arcs[0]).toEqual({ dash: 50, gap: 50, offset: -0 });
    expect(arcs[1]).toEqual({ dash: 50, gap: 50, offset: -50 });
  });

  it('Summe der Dashes entspricht dem Umfang (total > 0)', () => {
    const c = 360;
    const arcs = donutArcs([2, 3, 5], c);
    const sum = arcs.reduce((s, a) => s + a.dash, 0);
    expect(sum).toBeCloseTo(c, 6);
  });
});
