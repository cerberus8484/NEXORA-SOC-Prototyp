import { describe, expect, it } from 'vitest';
import type { AgentAnalysis, AgentSuggestion } from '../../aiAgent/agentApi';
import { buildKiHistoryModel } from './kiHistoryModel';

const analysis: AgentAnalysis = {
  entities: {},
  iocs: [],
  assessment: 'PowerShell Downloader mit verdaechtigem Elternprozess.',
  verdict: 'suspicious',
  confidence: 72,
  riskLevel: 'High',
  confirmedFacts: ['powershell.exe mit EncodedCommand'],
  suspiciousIndicators: [],
  missingEvidence: [],
  recommendedActions: [],
  mitreAttack: [],
};

const suggestion = (overrides: Partial<AgentSuggestion> = {}): AgentSuggestion => ({
  id: 'run-1',
  ticketId: 'ticket-1',
  kind: 'triage',
  proposal: 'Triage',
  rationale: 'Rationale',
  verdict: 'suspicious',
  confidence: 72,
  status: 'pending',
  model: 'llama3.2:3b',
  reviewedBy: null,
  reviewReason: '',
  reviewedAt: null,
  createdAt: '2026-07-05T10:00:00Z',
  analysis,
  ...overrides,
});

describe('buildKiHistoryModel', () => {
  it('sortiert echte KI-Laeufe chronologisch und bildet die Zusammenfassung', () => {
    const model = buildKiHistoryModel([
      suggestion({ id: 'run-2', createdAt: '2026-07-05T12:00:00Z', confidence: 84, analysis: { ...analysis, confidence: 84 }, status: 'approved' }),
      suggestion({ id: 'run-1', createdAt: '2026-07-05T09:00:00Z', confidence: 61, analysis: { ...analysis, confidence: 61 }, status: 'pending' }),
      suggestion({ id: 'run-3', createdAt: '2026-07-05T14:00:00Z', confidence: 52, analysis: { ...analysis, confidence: 52 }, status: 'rejected', kind: 'next_steps' }),
    ]);

    expect(model.points.map((item) => item.id)).toEqual(['run-1', 'run-2', 'run-3']);
    expect(model.points[2]?.kindLabel).toBe('Next Steps');
    expect(model.summary).toEqual({
      totalRuns: 3,
      approved: 1,
      pending: 1,
      rejected: 1,
      modelCount: 1,
      trendLabel: 'Confidence sinkt',
    });
  });

  it('ignoriert Vorschlaege ohne strukturierte Analyse und bleibt ehrlich bei duennen Daten', () => {
    const model = buildKiHistoryModel([
      suggestion({ id: 'draft-only', analysis: null, createdAt: '2026-07-05T08:00:00Z' }),
      suggestion({ id: 'run-1', createdAt: '2026-07-05T09:00:00Z', analysis: { ...analysis, confidence: 70 } }),
    ]);

    expect(model.points).toHaveLength(1);
    expect(model.summary.totalRuns).toBe(1);
    expect(model.summary.trendLabel).toBe('Noch kein Verlaufstrend');
  });
});
