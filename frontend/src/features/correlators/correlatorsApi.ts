// correlatorsApi — Sicht auf das Correlation Operations Center (P_CORR_ADMIN_1).
// Admin-/Analyst-Endpunkte unter /v1/correlators. Read-only + correlator-skopierter
// Config-Lifecycle (Draft → Submit → Decision). KEIN Apply/Restart/Reload — gibt es nicht.

import { api } from '../../lib/apiClient';

// ── Enums (spiegeln Backend-Domain) ─────────────────────────────────────────

export type PresentationStatus =
  | 'pending' | 'running' | 'retrying' | 'completed' | 'failed' | 'superseded';

export type RiskClass = 'low' | 'medium' | 'high' | 'prohibited';
// 'supported' nur wenn apply-eligible UND der globale Server-Kill-Switch an ist.
export type ApplyStatus = 'not_supported' | 'supported';
export type DraftStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

// ── Domain-Typen ─────────────────────────────────────────────────────────────

export interface QueueSummary {
  total: number;
  active: number;
  pending: number;
  running: number;
  retrying: number;
  completed: number;
  failed: number;     // nur ECHTE Fehler (ohne superseded)
  superseded: number; // durch neuere Revision ersetzt
}

export interface CorrelatorSummary {
  id: string;
  name: string;
  description: string;
  engineVersion: string;
  riskClass: RiskClass;
  inputSources: string[];
  outputTypes: string[];
  configTargetId: string;
  configCapabilityIds: string[];
  queue: QueueSummary;
  lastActivityAt: string | null;
}

export interface JobSummary {
  id: string;
  ticketId: string;
  presentationStatus: PresentationStatus;
  superseded: boolean;
  engineVersion: string;
  sourceRevision: string;
  inputHash: string;
  resultReference: string | null;
  retryCount: number;
  failureSummary: string | null; // redigiert; bei superseded null
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ResultSummary {
  id: string;
  ticketId: string;
  jobId: string | null;
  inputHash: string;
  sourceRevision: string;
  engineVersion: string;
  eventCount: number;
  sources: { source: string; count: number }[];
  evidenceRefCount: number;
  createdAt: string | null;
}

export interface CapabilityField {
  name: string;
  type: string;
  required: boolean;
  default: unknown;
  sensitive: boolean;
}

export interface DraftView {
  id: string;
  capabilityId: string;
  targetId: string;
  value: Record<string, unknown>; // sensible Felder bereits redigiert
  status: DraftStatus;
  version: number;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityView {
  id: string;
  scope: string;
  risk: RiskClass;
  description: string;
  effect: string;
  applyImpact: 'none' | 'reload' | 'restart';
  applyStatus: ApplyStatus;
  editable: boolean;
  sensitiveFields: string[];
  allowedTargets: string[];
  fields: CapabilityField[];
}

export interface BoundCapability extends CapabilityView {
  drafts: DraftView[];
}

export interface CorrelatorConfig {
  bound: BoundCapability[];
  reserved: CapabilityView[];
}

export interface AuditEntry {
  id: string;
  type: string;
  actor: string | null;
  capabilityId: string;
  targetId: string | null;
  draftId: string | null;
  before: Record<string, unknown> | null; // redigiert
  after: Record<string, unknown> | null;  // redigiert
  at: string;
}

// ── Request-Bodies ───────────────────────────────────────────────────────────

// ── Validierung + Apply-Plan (P_CORR_ADMIN_2 Stufe 1, KEIN Apply) ────────────

export interface ValidationResult {
  draftId: string;
  capabilityId: string;
  valid: boolean;
  value: Record<string, unknown> | null; // redigiert
  errors: string[];
}

export interface PlanChange { key: string; before: unknown; after: unknown }
export interface PlanUnchanged { key: string; value: unknown }

export interface ApplyPlan {
  draftId: string;
  draftStatus: DraftStatus;
  capabilityId: string;
  targetId: string | null;
  applyImpact: 'none' | 'reload' | 'restart';
  applyStatus: ApplyStatus;     // 'not_supported'
  applyEligible: boolean;       // dürfte SPÄTER mal angewendet werden
  wouldApply: boolean;          // immer false in dieser Stufe
  before: Record<string, unknown>; // redigiert
  after: Record<string, unknown>;  // redigiert
  changes: PlanChange[];
  unchanged: PlanUnchanged[];
  note: string;
  generatedAt: string;
}

// ── Worker Live-Health (P_CORR_ADMIN_2 Stufe 3) ──────────────────────────────

export interface WorkerHealth {
  workerId: string;
  present: boolean;
  lastHeartbeatAt?: string | null;
  ageMs: number | null;
  heartbeatFresh: boolean;
  adoptedConfigVersions: Record<string, number>;
  queueProcessingState: string;
  queueOk: boolean;
  lastJobOutcome: string | null;
  killSwitchEnabled: boolean;
  applyReady: boolean;       // fail-closed: blockiert bis alle Live-Signale + Kill-Switch da
  reasons: string[];
}

export interface CreateDraftBody { capabilityId: string; value: Record<string, unknown> }
export interface UpdateDraftBody { value: Record<string, unknown>; expectedVersion: number }
export interface SubmitBody { expectedVersion: number }
export interface DecisionBody { decision: 'approved' | 'rejected'; expectedVersion: number; note?: string }

// ── API-Hüllen ───────────────────────────────────────────────────────────────

interface ListResponse<T> { data: T[]; total?: number; requestId?: string }
interface ItemResponse<T> { data: T; requestId?: string }
export interface JobsParams { status?: PresentationStatus; limit?: number; offset?: number }
export interface PageParams { limit?: number; offset?: number }

// ── Client ───────────────────────────────────────────────────────────────────

const ROOT = '/correlators';

export const correlatorsApi = {
  /** GET /correlators — Registry mit Queue-Summary. */
  list: (opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<CorrelatorSummary>>(ROOT, undefined, opts),

  /** GET /correlators/:id — Detail-Stammdaten + Queue-Summary. */
  get: (id: string, opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<CorrelatorSummary>>(`${ROOT}/${id}`, undefined, opts),

  /** GET /correlators/:id/jobs — Job-Summaries (paginiert, bounded). */
  listJobs: (id: string, params?: JobsParams, opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<JobSummary>>(`${ROOT}/${id}/jobs`, params as Record<string, string | number> | undefined, opts),

  /** GET /correlators/:id/results — Result-Summaries (nur Meta, kein Payload). */
  listResults: (id: string, params?: PageParams, opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<ResultSummary>>(`${ROOT}/${id}/results`, params as Record<string, number> | undefined, opts),

  /** GET /correlators/:id/config — gebundene + reservierte Capabilities (+ Drafts). */
  getConfig: (id: string, opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<CorrelatorConfig>>(`${ROOT}/${id}/config`, undefined, opts),

  /** GET /correlators/:id/audit — Config-Audit-Spur der gebundenen Capabilities. */
  listAudit: (id: string, params?: { limit?: number }, opts?: { signal?: AbortSignal }) =>
    api.get<ListResponse<AuditEntry>>(`${ROOT}/${id}/audit`, params as Record<string, number> | undefined, opts),

  // ── Sichere Aktionen (KEIN Apply) ───────────────────────────────────────────
  createDraft: (id: string, body: CreateDraftBody) =>
    api.post<ItemResponse<DraftView>>(`${ROOT}/${id}/drafts`, body),

  updateDraft: (id: string, draftId: string, body: UpdateDraftBody) =>
    api.put<ItemResponse<DraftView>>(`${ROOT}/${id}/drafts/${draftId}`, body),

  submitDraft: (id: string, draftId: string, body: SubmitBody) =>
    api.post<ItemResponse<DraftView>>(`${ROOT}/${id}/drafts/${draftId}/submit`, body),

  decideDraft: (id: string, draftId: string, body: DecisionBody) =>
    api.post<ItemResponse<DraftView>>(`${ROOT}/${id}/drafts/${draftId}/decision`, body),

  /** Separate Validierung (nicht-mutierend). KEIN Apply. */
  validateDraft: (id: string, draftId: string) =>
    api.post<ItemResponse<ValidationResult>>(`${ROOT}/${id}/drafts/${draftId}/validate`),

  /** Read-only Apply-Plan-Vorschau (wouldApply=false). KEIN Apply. */
  getPlan: (id: string, draftId: string, opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<ApplyPlan>>(`${ROOT}/${id}/drafts/${draftId}/plan`, undefined, opts),

  /** Read-only Worker-Live-Health (Heartbeat, übernommene Version, Queue, Apply-Readiness). */
  getWorkerHealth: (id: string, opts?: { signal?: AbortSignal }) =>
    api.get<ItemResponse<WorkerHealth>>(`${ROOT}/${id}/worker-health`, undefined, opts),
};
