import type { AgentSuggestion } from '../../aiAgent/agentApi';

export interface KiHistoryPoint {
  id: string;
  createdAt: string;
  kind: AgentSuggestion['kind'];
  kindLabel: string;
  verdict: string;
  status: AgentSuggestion['status'];
  confidence: number | null;
  model: string;
  note: string;
}

export interface KiHistorySummary {
  totalRuns: number;
  approved: number;
  pending: number;
  rejected: number;
  modelCount: number;
  trendLabel: string;
}

export interface KiHistoryViewModel {
  points: KiHistoryPoint[];
  summary: KiHistorySummary;
}

const KIND_LABELS: Record<AgentSuggestion['kind'], string> = {
  triage: 'Triage',
  action: 'Action',
  enrichment: 'Enrichment',
  false_positive_review: 'False Positive Review',
  incident_recommendation: 'Incident Recommendation',
  customer_response: 'Customer Response',
  report_draft: 'Report Draft',
  hunt_suggestion: 'Hunt Suggestion',
  evidence_explanation: 'Evidence Explanation',
  mitre_mapping: 'MITRE Mapping',
  next_steps: 'Next Steps',
};

function sortByCreatedAtAsc(list: AgentSuggestion[]): AgentSuggestion[] {
  return [...list].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

function noteForPoint(item: AgentSuggestion): string {
  const analysis = item.analysis ?? null;
  return analysis?.assessment || analysis?.whyItMatters || item.proposal || item.rationale || '';
}

function buildTrendLabel(points: KiHistoryPoint[]): string {
  if (points.length < 2) return 'Noch kein Verlaufstrend';
  const first = points[0].confidence;
  const last = points[points.length - 1].confidence;
  if (first == null || last == null) return 'Confidence unvollstaendig';
  if (last > first) return 'Confidence steigt';
  if (last < first) return 'Confidence sinkt';
  return 'Confidence stabil';
}

export function buildKiHistoryModel(list: AgentSuggestion[]): KiHistoryViewModel {
  const points = sortByCreatedAtAsc(list)
    .filter((item) => item.analysis)
    .map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      kind: item.kind,
      kindLabel: KIND_LABELS[item.kind] ?? item.kind,
      verdict: item.analysis?.verdict || item.verdict || 'unknown',
      status: item.status,
      confidence: typeof item.analysis?.confidence === 'number'
        ? item.analysis.confidence
        : (typeof item.confidence === 'number' ? item.confidence : null),
      model: item.model || 'unbekannt',
      note: noteForPoint(item),
    }));

  return {
    points,
    summary: {
      totalRuns: points.length,
      approved: points.filter((item) => item.status === 'approved').length,
      pending: points.filter((item) => item.status === 'pending').length,
      rejected: points.filter((item) => item.status === 'rejected').length,
      modelCount: new Set(points.map((item) => item.model).filter(Boolean)).size,
      trendLabel: buildTrendLabel(points),
    },
  };
}
