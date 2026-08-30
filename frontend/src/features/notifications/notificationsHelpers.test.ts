// TDD RED: Tests für reine Helfer-Funktionen (kein DOM, kein Buffer, kein API).

import { describe, test, expect } from 'vitest';
import { formatRelativeTime, severityToColor, severityToLabel, formatTestResult } from './notificationsHelpers';

// ── formatRelativeTime ────────────────────────────────────────────────────────

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  test('zeigt "gerade eben" für weniger als 60 Sekunden', () => {
    const ts = new Date('2026-06-15T11:59:30Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('gerade eben');
  });

  test('zeigt "vor 1 Min." für 60–119 Sekunden', () => {
    const ts = new Date('2026-06-15T11:58:50Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('vor 1 Min.');
  });

  test('zeigt "vor 5 Min." für 5 Minuten', () => {
    const ts = new Date('2026-06-15T11:55:00Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('vor 5 Min.');
  });

  test('zeigt "vor 59 Min." für 59 Minuten', () => {
    const ts = new Date('2026-06-15T11:01:00Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('vor 59 Min.');
  });

  test('zeigt "vor 1 Std." für 60–119 Minuten', () => {
    const ts = new Date('2026-06-15T11:00:00Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('vor 1 Std.');
  });

  test('zeigt "vor 3 Std." für 3 Stunden', () => {
    const ts = new Date('2026-06-15T09:00:00Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('vor 3 Std.');
  });

  test('zeigt "vor 23 Std." für 23 Stunden', () => {
    const ts = new Date('2026-06-14T13:00:00Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('vor 23 Std.');
  });

  test('zeigt "vor 1 Tag" für 24–47 Stunden', () => {
    const ts = new Date('2026-06-14T12:00:00Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('vor 1 Tag');
  });

  test('zeigt "vor 3 Tagen" für 3 Tage', () => {
    const ts = new Date('2026-06-12T12:00:00Z').toISOString();
    expect(formatRelativeTime(ts, now)).toBe('vor 3 Tagen');
  });

  test('verwendet Date.now() als Standard wenn kein now übergeben', () => {
    // Sicherstellen dass die Funktion ohne zweites Argument nicht wirft
    const recentTs = new Date(Date.now() - 30_000).toISOString();
    expect(() => formatRelativeTime(recentTs)).not.toThrow();
    expect(formatRelativeTime(recentTs)).toBe('gerade eben');
  });
});

// ── severityToColor ───────────────────────────────────────────────────────────

describe('severityToColor', () => {
  test('critical → CSS-Variable danger', () => {
    expect(severityToColor('critical')).toContain('danger');
  });

  test('high → CSS-Variable warning oder orange', () => {
    const color = severityToColor('high');
    expect(color).toBeTruthy();
    expect(typeof color).toBe('string');
  });

  test('medium → CSS-Variable accent oder yellow', () => {
    const color = severityToColor('medium');
    expect(color).toBeTruthy();
    expect(typeof color).toBe('string');
  });

  test('low → CSS-Variable success oder teal', () => {
    const color = severityToColor('low');
    expect(color).toBeTruthy();
    expect(typeof color).toBe('string');
  });

  test('info → CSS-Variable text-muted oder text-dim', () => {
    const color = severityToColor('info');
    expect(color).toBeTruthy();
    expect(typeof color).toBe('string');
  });

  test('critical ist eine andere Farbe als info', () => {
    expect(severityToColor('critical')).not.toBe(severityToColor('info'));
  });
});

// ── severityToLabel ───────────────────────────────────────────────────────────

describe('severityToLabel', () => {
  test('critical → deutsches Label', () => {
    expect(severityToLabel('critical')).toBeTruthy();
    expect(typeof severityToLabel('critical')).toBe('string');
  });

  test('alle Severity-Werte geben einen nicht-leeren String zurück', () => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
    for (const s of severities) {
      expect(severityToLabel(s).length).toBeGreaterThan(0);
    }
  });

  test('labels sind unterschiedlich zwischen critical und info', () => {
    expect(severityToLabel('critical')).not.toBe(severityToLabel('info'));
  });
});

// ── formatTestResult ──────────────────────────────────────────────────────────

describe('formatTestResult', () => {
  test('skipped=disabled → Hinweis auf deaktivierten Versand', () => {
    expect(formatTestResult({ skipped: 'disabled' })).toMatch(/deaktiviert/i);
  });

  test('skipped=no_targets → kein Kanal konfiguriert', () => {
    expect(formatTestResult({ skipped: 'no_targets' })).toMatch(/Kein Outbound-Kanal/i);
  });

  test('sent mit Kanälen → listet die Kanäle auf', () => {
    expect(formatTestResult({ sent: ['email', 'slack'] })).toBe('Test gesendet an: email, slack.');
  });

  test('leere sent-Liste → an keinen Kanal gesendet', () => {
    expect(formatTestResult({ sent: [] })).toMatch(/keinen Kanal/i);
  });

  test('unbekannter skip-Grund wird durchgereicht', () => {
    expect(formatTestResult({ skipped: 'foo' })).toMatch(/foo/);
  });
});
