import { describe, test, expect } from 'vitest';
import { formatBytes, barHeights } from './systemFormat';

describe('formatBytes', () => {
  test('Basis-1024-Einheiten', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20.0 MB');
    expect(formatBytes(34359738368)).toBe('32.0 GB');
  });
  test('>=100 wird gerundet', () => {
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB');
  });
  test('negativ/leer → 0 B', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('barHeights', () => {
  test('anteilig am Maximum', () => {
    expect(barHeights([0, 50, 100], 40)).toEqual([0, 20, 40]);
  });
  test('alles 0 → alles 0', () => {
    expect(barHeights([0, 0], 40)).toEqual([0, 0]);
  });
  test('kleiner >0-Wert bekommt mindestens 1px', () => {
    expect(barHeights([1000, 1], 40)[1]).toBe(1);
  });
});
