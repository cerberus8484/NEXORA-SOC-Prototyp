// TDD RED: Mapping-Helfer für den Dashboard-Activity-Feed.
// Kein Buffer, kein @types/node — reine Logik-Funktionen (no JSX, no DOM).

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveActionLabel, relTime, KNOWN_ACTIONS } from './activityFeedModel';

// ── resolveActionLabel ────────────────────────────────────────────────────────

describe('resolveActionLabel', () => {
  test('mappt TICKET_CREATE auf deutschen Label', () => {
    expect(resolveActionLabel('TICKET_CREATE')).toBe('Ticket erstellt');
  });

  test('mappt TICKET_UPDATE auf deutschen Label', () => {
    expect(resolveActionLabel('TICKET_UPDATE')).toBe('Ticket aktualisiert');
  });

  test('mappt TICKET_DELETE auf deutschen Label', () => {
    expect(resolveActionLabel('TICKET_DELETE')).toBe('Ticket gelöscht');
  });

  test('mappt evidence.create auf deutschen Label', () => {
    expect(resolveActionLabel('evidence.create')).toBe('Evidence gesichert');
  });

  test('mappt evidence.custody auf deutschen Label', () => {
    expect(resolveActionLabel('evidence.custody')).toBe('Evidence reviewed');
  });

  test('mappt LOGIN auf deutschen Label', () => {
    expect(resolveActionLabel('LOGIN')).toBe('Login');
  });

  test('gibt unbekannte Aktion unverändert zurück', () => {
    expect(resolveActionLabel('UNKNOWN_ACTION')).toBe('UNKNOWN_ACTION');
  });

  test('gibt leeren String zurück wenn leer übergeben', () => {
    expect(resolveActionLabel('')).toBe('');
  });

  test('gibt null-ähnliche Strings unverändert zurück', () => {
    expect(resolveActionLabel('null')).toBe('null');
  });

  test('Sonderzeichen in Aktions-Keys werden unverändert zurückgegeben', () => {
    expect(resolveActionLabel('ticket.create-special')).toBe('ticket.create-special');
  });
});

// ── KNOWN_ACTIONS ─────────────────────────────────────────────────────────────

describe('KNOWN_ACTIONS', () => {
  test('enthält alle Pflicht-Aktionen als Keys', () => {
    const required = ['TICKET_CREATE', 'TICKET_UPDATE', 'TICKET_DELETE', 'evidence.create', 'evidence.custody', 'LOGIN'];
    for (const key of required) {
      expect(KNOWN_ACTIONS).toHaveProperty(key);
    }
  });

  test('alle Werte sind nicht-leere Strings', () => {
    for (const [, label] of Object.entries(KNOWN_ACTIONS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

// ── relTime ───────────────────────────────────────────────────────────────────

describe('relTime', () => {
  const NOW = new Date('2026-06-15T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('weniger als 60 Sekunden → "gerade eben"', () => {
    const ts = new Date(NOW - 30_000).toISOString();
    expect(relTime(ts)).toBe('gerade eben');
  });

  test('genau 0 Sekunden Differenz → "gerade eben"', () => {
    const ts = new Date(NOW).toISOString();
    expect(relTime(ts)).toBe('gerade eben');
  });

  test('genau 60 Sekunden → "vor 1 min"', () => {
    const ts = new Date(NOW - 60_000).toISOString();
    expect(relTime(ts)).toBe('vor 1 min');
  });

  test('90 Sekunden → "vor 1 min"', () => {
    const ts = new Date(NOW - 90_000).toISOString();
    expect(relTime(ts)).toBe('vor 1 min');
  });

  test('3600 Sekunden → "vor 1 h"', () => {
    const ts = new Date(NOW - 3_600_000).toISOString();
    expect(relTime(ts)).toBe('vor 1 h');
  });

  test('5400 Sekunden (1,5 h) → "vor 1 h"', () => {
    const ts = new Date(NOW - 5_400_000).toISOString();
    expect(relTime(ts)).toBe('vor 1 h');
  });

  test('7200 Sekunden (2 h) → "vor 2 h"', () => {
    const ts = new Date(NOW - 7_200_000).toISOString();
    expect(relTime(ts)).toBe('vor 2 h');
  });

  test('genau 86400 Sekunden (1 Tag) → "vor 1 d"', () => {
    const ts = new Date(NOW - 86_400_000).toISOString();
    expect(relTime(ts)).toBe('vor 1 d');
  });

  test('172800 Sekunden (2 Tage) → "vor 2 d"', () => {
    const ts = new Date(NOW - 172_800_000).toISOString();
    expect(relTime(ts)).toBe('vor 2 d');
  });

  test('Zeitstempel in der Zukunft → "gerade eben" (kein negativer Wert)', () => {
    const ts = new Date(NOW + 10_000).toISOString();
    expect(relTime(ts)).toBe('gerade eben');
  });

  test('ungültiger Datums-String → "gerade eben" (kein Crash)', () => {
    expect(relTime('not-a-date')).toBe('gerade eben');
  });
});
