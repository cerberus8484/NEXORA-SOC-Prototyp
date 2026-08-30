import { describe, expect, it } from 'vitest';
import { buildDetectionPanelState } from './detectionPanelModel';
import type { DetectionSourceRow } from './detectionSourcesModel';
import type { SourceActivityRow } from './sourceActivityModel';

const rule = (overrides: Partial<DetectionSourceRow> = {}): DetectionSourceRow => ({
  key: 'rule:100205',
  label: 'Regel 100205',
  count: 7,
  ...overrides,
});

const source = (overrides: Partial<SourceActivityRow> = {}): SourceActivityRow => ({
  source: 'wazuh',
  label: 'Wazuh',
  total: 120,
  recent: 12,
  lastSeen: '2026-07-05T09:30:00Z',
  liveness: 'active',
  ...overrides,
});

describe('buildDetectionPanelState', () => {
  it('zeigt fuer Engineer echte Regelquellen, wenn SOC-Metriken vorhanden sind', () => {
    const panel = buildDetectionPanelState({
      canViewRules: true,
      ruleRows: [rule()],
      ruleError: false,
      sourceRows: [source()],
      sourceError: false,
    });

    expect(panel.mode).toBe('rules');
    expect(panel.badge).toBe('SOC-Metriken');
    expect(panel.ruleRows).toHaveLength(1);
    expect(panel.sourceRows).toEqual([]);
  });

  it('faellt fuer Analysten ehrlich auf Ticket-Quellen zurueck', () => {
    const panel = buildDetectionPanelState({
      canViewRules: false,
      ruleRows: [],
      ruleError: false,
      sourceRows: [source(), source({ source: 'email', label: 'E-Mail' })],
      sourceError: false,
    });

    expect(panel.mode).toBe('sources');
    expect(panel.badge).toBe('Ingestion · 24h');
    expect(panel.title).toBe('Aktive Ticket-Quellen');
    expect(panel.sourceRows).toHaveLength(2);
  });

  it('nutzt Ticket-Quellen als Fallback, wenn SOC-Metriken fuer Engineer fehlschlagen', () => {
    const panel = buildDetectionPanelState({
      canViewRules: true,
      ruleRows: [],
      ruleError: true,
      sourceRows: [source()],
      sourceError: false,
    });

    expect(panel.mode).toBe('sources');
    expect(panel.badge).toBe('Ingestion-Fallback');
    expect(panel.description).toMatch(/Fallback/i);
  });

  it('bleibt ehrlich leer, wenn weder Regel- noch Quell-Daten verfuegbar sind', () => {
    const panel = buildDetectionPanelState({
      canViewRules: false,
      ruleRows: [],
      ruleError: false,
      sourceRows: [],
      sourceError: false,
    });

    expect(panel.mode).toBe('empty');
    expect(panel.title).toBe('Noch keine Erkennungsquellen');
  });
});
