import { describe, test, expect } from 'vitest';
import { topSources, sourceLabel } from './sourceActivityModel';
import type { SourceActivity } from '../collectors/collectorsStatusApi';

const src = (o: Partial<SourceActivity>): SourceActivity => ({ source: 'x', total: 0, recent: 0, lastSeen: null, ...o });

describe('sourceLabel', () => {
  test('humanisiert bekannte Quellen', () => {
    expect(sourceLabel('dataplane')).toBe('Korrelierter Vorfall');
    expect(sourceLabel('crowdsec')).toBe('CrowdSec');
    expect(sourceLabel('email')).toBe('E-Mail');
    expect(sourceLabel('threat_hunt')).toBe('Threat Hunt');
  });
  test('unbekannte Quelle → Rohwert (kein Verschlucken)', () => {
    expect(sourceLabel('mystery')).toBe('mystery');
  });
});

describe('topSources', () => {
  test('sortiert nach 24h-Aktivität, dann Gesamt, dann Name', () => {
    const rows = topSources([
      src({ source: 'wazuh', recent: 2, total: 100 }),
      src({ source: 'email', recent: 9, total: 10 }),
      src({ source: 'qradar', recent: 2, total: 200 }),
    ]);
    expect(rows.map((r) => r.source)).toEqual(['email', 'qradar', 'wazuh']);
  });

  test('deckelt auf limit (Top-N)', () => {
    const many = Array.from({ length: 10 }, (_, i) => src({ source: `s${i}`, recent: i }));
    expect(topSources(many, 3)).toHaveLength(3);
    // höchste recent zuerst → s9, s8, s7
    expect(topSources(many, 3).map((r) => r.source)).toEqual(['s9', 's8', 's7']);
  });

  test('attachiert Label + Liveness (active/quiet/none) ehrlich', () => {
    const rows = topSources([
      src({ source: 'wazuh', recent: 5, total: 5, lastSeen: '2026-07-04T10:00:00Z' }),
      src({ source: 'qradar', recent: 0, total: 3, lastSeen: '2026-06-01T10:00:00Z' }),
      src({ source: 'splunk', recent: 0, total: 0, lastSeen: null }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.source, r]));
    expect(byId.wazuh).toMatchObject({ label: 'Wazuh', liveness: 'active' });
    expect(byId.qradar).toMatchObject({ label: 'QRadar', liveness: 'quiet' });
    expect(byId.splunk).toMatchObject({ label: 'Splunk', liveness: 'none' });
  });

  test('leere Liste → leer', () => {
    expect(topSources([])).toEqual([]);
  });
});
