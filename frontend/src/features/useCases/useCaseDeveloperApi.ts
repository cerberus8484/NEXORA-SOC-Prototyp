import { api } from '../../lib/apiClient';

export type UseCaseStatus = 'draft' | 'in_review' | 'approved' | 'rejected' | 'published';
export type UseCaseSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface UseCaseMitre { tactic?: string; technique?: string }
export interface UseCaseDetectionLogic { language: string; queryOrRule: string; explanation: string }
export interface UseCaseTestCase {
  name: string; type: 'true_positive' | 'false_positive'; event: unknown; expectedResult: string;
}

export interface UseCaseDraft {
  id: string;
  ucNumber?: string | null;   // UC-INC000001 — menschenlesbare Katalognummer (bei Erstellung vergeben)
  title: string;
  sourceType: 'ticket' | 'finding' | 'evidence' | 'wazuh_rule' | 'manual';
  sourceId: string;
  status: UseCaseStatus;
  description: string;
  detectionGoal: string;
  dataSources: string[];
  requiredFields: string[];
  detectionLogic: UseCaseDetectionLogic;
  mitre: UseCaseMitre[];
  severity: UseCaseSeverity;
  confidence: number;
  falsePositiveRisks: string[];
  testCases: UseCaseTestCase[];
  recommendedActions: string[];
  playbookSteps: string[];
  generatedBy: string;
  reviewedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityCheck { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail?: string }
export interface QualityResult { checks: QualityCheck[]; passed: boolean; score: number; blocking: string[] }

export interface ExportResult {
  format: string;
  language: string;
  content: string;
}

const BASE = '/use-case-drafts';

/**
 * Lädt die Export-Vorschau für einen Draft in einem bestimmten Format.
 * Gibt ExportResult direkt zurück (ausgepackt aus { data }).
 */
export async function exportDraft(id: string, format: string): Promise<ExportResult> {
  const res = await api.get<{ data: ExportResult }>(`${BASE}/${id}/export`, { format });
  return res.data;
}

export const useCaseApi = {
  /** Erzeugt einen Draft aus einer SOC-Quelle (analyst+). Liefert Draft + Quality. */
  generate: (sourceType: UseCaseDraft['sourceType'], sourceId: string) =>
    api.post<{ data: UseCaseDraft; quality: QualityResult }>(`${BASE}/generate`, { sourceType, sourceId }),
  /** Liste (paginiert), optional nach Status. */
  list: (params?: { status?: string; limit?: number; offset?: number }) =>
    api.get<{ data: UseCaseDraft[]; total: number }>(BASE, params),
  get: (id: string) => api.get<{ data: UseCaseDraft }>(`${BASE}/${id}`),
  quality: (id: string) => api.get<{ quality: QualityResult }>(`${BASE}/${id}/quality`),
  /** Status-Übergänge — RBAC serverseitig (review=analyst, approve/reject=engineer, publish=admin). */
  review:  (id: string) => api.post<{ data: UseCaseDraft }>(`${BASE}/${id}/review`),
  approve: (id: string) => api.post<{ data: UseCaseDraft }>(`${BASE}/${id}/approve`),
  reject:  (id: string) => api.post<{ data: UseCaseDraft }>(`${BASE}/${id}/reject`),
  publish: (id: string) => api.post<{ data: UseCaseDraft }>(`${BASE}/${id}/publish`),
};
