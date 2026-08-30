import { describe, test, expect } from 'vitest';
import {
  healthTone, healthLabel, collectorStatusTone, collectorStatusLabel, formatAge, formatTimestamp,
} from './dataplaneView';

describe('healthTone / healthLabel', () => {
  test('mappt die drei Health-Zustände', () => {
    expect(healthTone('healthy')).toBe('success');
    expect(healthTone('degraded')).toBe('warning');
    expect(healthTone('stale')).toBe('muted');
    expect(healthLabel('healthy')).toBe('Gesund');
    expect(healthLabel('degraded')).toBe('Beeinträchtigt');
    expect(healthLabel('stale')).toBe('Veraltet');
  });
});

describe('collectorStatusTone / collectorStatusLabel', () => {
  test('running ist success, failed ist danger', () => {
    expect(collectorStatusTone('running')).toBe('success');
    expect(collectorStatusTone('failed')).toBe('danger');
    expect(collectorStatusTone('pending')).toBe('warning');
    expect(collectorStatusLabel('running')).toBe('Läuft');
    expect(collectorStatusLabel('failed')).toBe('Fehler');
  });
});

describe('formatAge', () => {
  test('Sekunden, Minuten, Stunden, Tage', () => {
    expect(formatAge(12_000)).toBe('vor 12s');
    expect(formatAge(90_000)).toBe('vor 1m');
    expect(formatAge(2 * 3600_000)).toBe('vor 2h');
    expect(formatAge(3 * 86_400_000)).toBe('vor 3d');
  });

  test('ehrlich „—" bei null/negativ/NaN', () => {
    expect(formatAge(null)).toBe('—');
    expect(formatAge(-5)).toBe('—');
    expect(formatAge(NaN)).toBe('—');
  });
});

describe('formatTimestamp', () => {
  test('null und ungültig → „—"', () => {
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp('nonsense')).toBe('—');
  });

  test('gültiger ISO-String wird formatiert (nicht „—")', () => {
    expect(formatTimestamp('2026-06-30T12:00:00.000Z')).not.toBe('—');
  });
});
