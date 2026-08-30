import { api } from '../../lib/apiClient';

export interface DetectionRule {
  id: number;
  level: number;
  description: string;
  groups: string[];
  mitre: string[];
  filename: string;
}

// ─── PublishedDetection — Snapshot der Detection-Logik nach UCD-Publish ────────
// DSGVO: Enthält KEINE testCases/description (kein PII-Snapshot).
export interface PublishedDetection {
  id: string;
  draftId: string;
  title: string;
  language: 'wazuh' | 'sigma' | 'splunk' | 'qradar' | 'generic';
  rule: string;
  explanation: string;
  mitre: Array<{ tactic?: string; technique: string }>;
  severity: string;
  sourceType: string;
  sourceId: string;
  publishedBy: string;
  createdAt: string;
}

// FP-Ausnahmen liegen im reservierten Wazuh-Custom-Range (siehe Backend
// wazuhRuleExceptionBuilder MIN_ID/MAX_ID) bzw. tragen die Suppression-Gruppe.
export const FP_RULE_MIN = 900000;
export const FP_RULE_MAX = 920000;

/** Erkennt FP-Suppression-Regeln (eigener ID-Range ODER Gruppe soc_false_positive/soc_fp_exceptions). */
export function isFpRule(rule: Pick<DetectionRule, 'id' | 'groups'>): boolean {
  if (rule.id >= FP_RULE_MIN && rule.id <= FP_RULE_MAX) return true;
  return (rule.groups || []).some((g) => g === 'soc_false_positive' || g === 'soc_fp_exceptions');
}

export interface CustomRulePayload {
  description: string;
  level: number;
  fieldName: string;
  fieldType: 'regex' | 'match';
  fieldValue: string;
  ifSid?: string;
  groups?: string[];
}

export const detectionApi = {
  /** Geladene Wazuh-Manager-Regeln (Detection Library). enabled:false ohne Wazuh-API. */
  list: (params: { search?: string; group?: string; level?: string; limit?: number; offset?: number }) =>
    api.get<{ enabled: boolean; data: DetectionRule[]; total: number }>('/detections', params),

  /** Schreibt eine neue Custom-Regel in nexora-custom-detections.xml auf dem Wazuh-Manager. */
  createCustom: (body: CustomRulePayload) =>
    api.post<{ ruleId: number; file: string; xml: string }>('/detections/custom', body),

  /** Nexora Published Detections — Snapshots aus UCD-Publish (Detection-Library-Einträge). */
  getPublishedDetections: (params?: { limit?: number; offset?: number }) =>
    api.get<{ data: PublishedDetection[]; total: number }>('/detections/published', params),
};
