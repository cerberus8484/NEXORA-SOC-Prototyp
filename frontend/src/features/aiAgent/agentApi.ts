import { api } from '../../lib/apiClient';

// ── Strukturierte KI-Analyse (camelCase) — Vertrag mit OllamaLlmProvider._buildAnalysis ──
export interface AnalysisHost { hostname?: string; fqdn?: string; agentId?: string; agentIp?: string; mac?: string; os?: string; osVersion?: string; }
export interface AnalysisDns { query?: string; answers?: string; status?: string; image?: string; }
export interface AnalysisUser { username?: string; domain?: string; sid?: string; privilege?: string; }
export interface AnalysisProcess {
  name?: string; path?: string; pid?: string; parentName?: string; commandLine?: string;
  hashSha256?: string; signed?: string | boolean; publisher?: string; originalFileName?: string;
}
export interface AnalysisFile {
  name?: string; path?: string; directory?: string; hashSha256?: string; signed?: string | boolean; createdAt?: string;
}
export interface AnalysisRegistry { key?: string; valueName?: string; oldValue?: string; newValue?: string; operation?: string; }
export interface AnalysisNetwork {
  sourceIp?: string; sourcePort?: string; sourceMac?: string; sourceHostname?: string;
  destinationIp?: string; destinationPort?: string; destinationMac?: string; destinationHostname?: string;
  protocol?: string; direction?: string; image?: string;
}
export interface AnalysisEntities {
  host?: AnalysisHost; user?: AnalysisUser; process?: AnalysisProcess;
  file?: AnalysisFile; registry?: AnalysisRegistry; network?: AnalysisNetwork; dns?: AnalysisDns;
}
export interface AnalysisIoc {
  type: string; value: string; role?: string; verdict?: string; reason?: string; evidenceSource?: string;
}
export interface AnalysisIndicator { type?: string; value?: string; reason?: string; }
export interface AnalysisAction { priority: number; action: string; details?: string; }
export interface AnalysisMitre { tactic?: string; technique?: string; techniqueId?: string; }
export interface AgentAnalysis {
  entities: AnalysisEntities;
  iocs: AnalysisIoc[];
  assessment?: string;
  verdict: string;
  confidence: number;
  riskLevel?: string;
  siemSeverity?: string;
  businessSeverity?: string;
  whyItMatters?: string;
  confirmedFacts: string[];
  suspiciousIndicators: AnalysisIndicator[];
  falsePositivePossibility?: { possible: boolean; likelihood?: string; reason?: string };
  missingEvidence: string[];
  affectedAssets?: string[];
  recommendedActions: AnalysisAction[];
  mitreAttack: AnalysisMitre[];
  analystNote?: string;
}

export interface AgentSuggestion {
  id: string;
  ticketId: string;
  // Synchron zu backend AgentSuggestion KINDS.
  kind: 'triage' | 'action' | 'enrichment'
    | 'false_positive_review' | 'incident_recommendation' | 'customer_response'
    | 'report_draft' | 'hunt_suggestion'
    | 'evidence_explanation' | 'mitre_mapping' | 'next_steps';
  proposal: string;
  rationale: string;
  verdict: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected';
  model: string;
  reviewedBy: string | null;
  reviewReason: string;
  reviewedAt: string | null;
  createdAt: string;
  analysis?: AgentAnalysis | null;
}

// Verdichtetes KI-FP-Signal fürs Analyse-Deck (rein, testbar).
export interface KiFpSignal { verdict: string; isFp: boolean; reason: string; confidence: number }

/**
 * Leitet aus einem KI-Vorschlag ein FP-Signal fürs Analyse-Deck ab.
 * isFp nur bei verdict 'false_positive' (analysis hat Vorrang vor Top-Level).
 * reason: bevorzugt die FP-Begründung, sonst Assessment/Rationale.
 */
export function deriveKiFp(s: AgentSuggestion | null | undefined): KiFpSignal | null {
  if (!s) return null;
  const a = s.analysis ?? null;
  const verdict = (a?.verdict || s.verdict || '').toLowerCase();
  if (!verdict) return null;
  const reason = a?.falsePositivePossibility?.reason || a?.assessment || s.rationale || '';
  return {
    verdict,
    isFp: verdict === 'false_positive',
    reason: reason.trim(),
    confidence: typeof a?.confidence === 'number' ? a.confidence : s.confidence,
  };
}

/** Jüngster KI-Vorschlag aus einer Liste (nach createdAt absteigend). */
export function latestSuggestion(list: AgentSuggestion[]): AgentSuggestion | null {
  if (!list.length) return null;
  return [...list].sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''))[0];
}

export const agentApi = {
  list: (status?: string) =>
    api.get<{ data: AgentSuggestion[]; total: number }>('/agent/suggestions', status ? { status } : undefined),
  /** Vorschläge zu einem Ticket (Backend filtert ?ticketId=). */
  forTicket: (ticketId: string) =>
    api.get<{ data: AgentSuggestion[]; total: number }>('/agent/suggestions', { ticketId }),
  /** Erzeugt einen Vorschlag. `note` = optionaler Analyst-Hinweis (Re-Propose mit Kontext). */
  propose: (ticketId: string, kind: string, note?: string) =>
    api.post<{ data: AgentSuggestion }>('/agent/propose', { ticketId, kind, note }),
  approve: (id: string) =>
    api.post<{ data: AgentSuggestion }>(`/agent/suggestions/${id}/approve`),
  reject: (id: string, reason: string) =>
    api.post<{ data: AgentSuggestion }>(`/agent/suggestions/${id}/reject`, { reason }),
  /** Read-only Transparenz der aktiven Safety-Floors (alle Rollen). */
  guardrails: () => api.get<{ data: Guardrails }>('/agent/guardrails'),
  /** KI-Nutzungs-/Latenz-Metriken seit Boot (engineer+admin). */
  metrics: () => api.get<{ data: AgentMetricsSnapshot }>('/agent/metrics'),
};

// ── KI-Settings Welle 2: Guardrails-Transparenz + Nutzungsmetriken ──
export interface Guardrails {
  evidenceFloor: {
    enabled: boolean; confirmedVtMin: number; suspiciousVtMin: number;
    confirmedConfidenceFloor: number; suspiciousConfidenceFloor: number;
  };
  benignFloor: { enabled: boolean; confidenceFloor: number };
  antiHallucination: { enabled: boolean };
  humanInTheLoop: { allSuggestionsRequireApproval: boolean; autonomyEnabled: boolean };
}

export interface AgentMetricsProvider {
  provider: string; model: string; calls: number; errors: number;
  avgLatencyMs: number; estTokens: number; estCostUsd: number;
}

export interface AgentMetricsSnapshot {
  sinceBoot: string; estimated: boolean;
  totals: {
    calls: number; errors: number; avgLatencyMs: number;
    estPromptTokens: number; estCompletionTokens: number; estCostUsd: number;
  };
  byProvider: AgentMetricsProvider[];
}
