import { describe, test, expect } from 'vitest';
import { buildTimeline, severityColor, type HostAlert } from './hostTimeline';

describe('severityColor', () => {
  test('mappt Schweregrade auf die korrekten CSS-Farben', () => {
    expect(severityColor('critical')).toBe('var(--danger)');
    expect(severityColor('high')).toBe('var(--accent-orange)');
    expect(severityColor('medium')).toBe('var(--warning)');
    expect(severityColor('low')).toBe('var(--text-muted)');
    expect(severityColor(undefined)).toBe('var(--text-muted)');
  });
});

describe('buildTimeline', () => {
  const alerts: HostAlert[] = [
    { id: 'a', title: 'Alt',    priority: 'high',     createdAt: '2026-06-10T08:00:00Z' },
    { id: 'b', title: 'Neu',    priority: 'critical', createdAt: '2026-06-12T08:00:00Z' },
    { id: 'c', title: 'Mitte',  priority: 'unknown',  createdAt: '2026-06-11T08:00:00Z' },
  ];

  test('sortiert neueste zuerst und setzt Severity-Farbe', () => {
    const tl = buildTimeline(alerts);
    expect(tl.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(tl[0].color).toBe('var(--danger)');
  });

  test('unbekannte Priorität fällt auf info zurück; leere Liste bleibt leer', () => {
    const tl = buildTimeline(alerts);
    const mitte = tl.find((i) => i.id === 'c');
    expect(mitte?.priority).toBe('info');
    expect(mitte?.title).toBe('Mitte');
    expect(buildTimeline([])).toEqual([]);
  });

  test('übernimmt Alert-History-Felder (ticketNr, mitre) und Titel-Fallback', () => {
    const tl = buildTimeline([
      { id: 'x', ticketNr: 'INC000007', mitre: 'T1059', priority: 'medium', createdAt: '2026-06-12T00:00:00Z' },
      { id: 'y', createdAt: '2026-06-11T00:00:00Z' },
    ]);
    expect(tl[0].ticketNr).toBe('INC000007');
    expect(tl[0].mitre).toBe('T1059');
    expect(tl[1].title).toBe('Ohne Titel');
    expect(tl[1].priority).toBe('info');
  });
});
