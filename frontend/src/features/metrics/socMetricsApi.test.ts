import { describe, it, expect } from 'vitest';
import { formatDuration, formatRate } from './socMetricsApi';

describe('formatDuration', () => {
  it('null/NaN → —', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
  });
  it('Minuten / Stunden / Tage', () => {
    expect(formatDuration(5 * 60000)).toBe('5 min');
    expect(formatDuration(90 * 60000)).toBe('1 h 30 min');
    expect(formatDuration(26 * 3600000)).toBe('1 d 2 h');
  });
});

describe('formatRate', () => {
  it('null → —', () => expect(formatRate(null)).toBe('—'));
  it('Anteil → Prozent', () => {
    expect(formatRate(0)).toBe('0.0 %');
    expect(formatRate(0.0179)).toBe('1.8 %');
    expect(formatRate(1)).toBe('100.0 %');
  });
});
