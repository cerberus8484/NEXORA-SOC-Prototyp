// autonomyApi — GET/POST/PUT/DELETE /v1/autonomy-policies + Ceiling-Hilfsfunktionen.
// Hält sich exakt an den API-Vertrag aus ADR-016.

import { api } from '../../lib/apiClient';

// ── Typen ──────────────────────────────────────────────────────────────────

export type ActionClass =
  | 'enrichment'
  | 'internal_state'
  | 'draft_generation'
  | 'detection_write'
  | 'host_response'
  | 'external_comms';

export type AutonomyMode = 'advisory' | 'assisted' | 'autonomous';

export type Verdict =
  | 'needs_more_info'
  | 'false_positive'
  | 'suspicious'
  | 'confirmed_incident';

export interface AutonomyPolicy {
  id: string;
  customer: string;
  actionClass: ActionClass;
  mode: AutonomyMode;
  minVerdict: Verdict;
  minConfidence: number;
  requireEvidenceFloor: boolean;
  maxPerHour: number;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomyStatus {
  enabled: boolean;
  actionClasses: ActionClass[];
  ceilings: Record<ActionClass, AutonomyMode>;
  modes: AutonomyMode[];
  verdicts: Verdict[];
}

// API-Hülle: LIST
interface PolicyListResponse {
  data: AutonomyPolicy[];
  total: number;
  requestId?: string;
}

// API-Hülle: Einzel / Create / Update
interface PolicyResponse {
  data: AutonomyPolicy;
  requestId?: string;
}

// API-Hülle: Status
interface StatusResponse {
  data: AutonomyStatus;
  requestId?: string;
}

// Filter für listPolicies
export interface PolicyListParams {
  customer?: string;
}

// Create-Body: alle Pflichtfelder außer server-generierten IDs
export type CreatePolicyBody = Pick<
  AutonomyPolicy,
  | 'customer'
  | 'actionClass'
  | 'mode'
  | 'minVerdict'
  | 'minConfidence'
  | 'requireEvidenceFloor'
  | 'maxPerHour'
  | 'enabled'
>;

// Update-Body: alle Felder optional
export type UpdatePolicyBody = Partial<CreatePolicyBody>;

// ── Decken-Konstanten (ADR-016 Taxonomie) ─────────────────────────────────

/**
 * Maximaler zulässiger Mode je Aktionsklasse (Decke).
 * Diese Werte sind ADR-016-kanonisch und dürfen durch keine Policy überschritten werden.
 */
export const ACTION_CLASS_CEILINGS: Record<ActionClass, AutonomyMode> = {
  enrichment:       'autonomous',
  internal_state:   'autonomous',
  draft_generation: 'autonomous',
  detection_write:  'assisted',   // max assisted — kein autonomous
  host_response:    'advisory',   // human-only
  external_comms:   'advisory',   // human-only
};

// Mode-Ordnung: höherer Index = weiter automatisiert
const MODE_ORDER: AutonomyMode[] = ['advisory', 'assisted', 'autonomous'];

/**
 * Prüft, ob `mode` die Decke für `actionClass` überschreitet.
 * Eine Policy sollte diese Funktion vor dem Speichern nutzen,
 * um einen klaren Hinweis im UI anzuzeigen.
 *
 * Hinweis: Die echte Durchsetzung liegt serverseitig.
 * Diese Frontend-Prüfung ist rein informativ.
 */
export function isCeilingViolation(actionClass: ActionClass, mode: AutonomyMode): boolean {
  const ceiling = ACTION_CLASS_CEILINGS[actionClass];
  return MODE_ORDER.indexOf(mode) > MODE_ORDER.indexOf(ceiling);
}

// ── API-Client ─────────────────────────────────────────────────────────────

export const autonomyApi = {
  /** GET /autonomy-policies/status — globaler Kill-Switch-Status + Metadaten. */
  getStatus: (opts?: { signal?: AbortSignal }) =>
    api.get<StatusResponse>('/autonomy-policies/status', undefined, opts),

  /** GET /autonomy-policies — Policy-Liste, optional nach customer gefiltert. */
  listPolicies: (params?: PolicyListParams, opts?: { signal?: AbortSignal }) =>
    api.get<PolicyListResponse>('/autonomy-policies', params as Record<string, string> | undefined, opts),

  /** GET /autonomy-policies/:id — einzelne Policy. */
  getPolicy: (id: string, opts?: { signal?: AbortSignal }) =>
    api.get<PolicyResponse>(`/autonomy-policies/${id}`, undefined, opts),

  /** POST /autonomy-policies — neue Policy anlegen. */
  createPolicy: (body: CreatePolicyBody) =>
    api.post<PolicyResponse>('/autonomy-policies', body),

  /** PUT /autonomy-policies/:id — Policy aktualisieren. */
  updatePolicy: (id: string, body: UpdatePolicyBody) =>
    api.put<PolicyResponse>(`/autonomy-policies/${id}`, body),

  /** DELETE /autonomy-policies/:id — Policy löschen. */
  deletePolicy: (id: string) =>
    api.del<void>(`/autonomy-policies/${id}`),
};
