// nis2Api — NIS2 Readiness & Evidence (P_NIS2_1 + P_NIS2_2).
// Arbeits-/Nachweis-Unterstützung — KEIN Konformitätsnachweis. Hält sich an den
// Backend-Vertrag /v1/nis2. Lesen: viewer+, Schreiben: admin.

import { api } from '../../lib/apiClient';

export type AssessmentStatus =
  | 'not_started'
  | 'in_progress'
  | 'evidence_collected'
  | 'needs_review'
  | 'addressed'
  | 'not_applicable';

export type EvidenceType =
  | 'ticket'
  | 'audit_event'
  | 'node'
  | 'integration'
  | 'gitops_profile'
  | 'document'
  | 'external_reference'
  | 'other';

export interface Nis2ControlRow {
  key: string;
  title: string;
  shortDescription: string;
  defaultRiskArea: string;
  sourceReference: string;
  status: AssessmentStatus;
  owner: string;
  dueDate: string | null;
  lastReviewedAt: string | null;
  evidenceCount: number;
  hasAssessment: boolean;
  overdue: boolean;
  missingEvidence: boolean;
  needsReview: boolean;
  reviewDue: boolean;
}

export interface Nis2Summary {
  catalogVersion: string;
  controlsTotal: number;
  evidenceCoverage: number;
  evidenceCoveragePct: number;
  needsReview: number;
  overdue: number;
  missingEvidence: number;
  reviewDue: number;
}

export interface Nis2Assessment {
  id: string;
  controlKey: string;
  status: AssessmentStatus;
  owner: string;
  dueDate: string | null;
  notes: string;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface Nis2EvidenceLink {
  id: string;
  assessmentId: string;
  evidenceType: EvidenceType;
  evidenceRef: string;
  title: string;
  description: string;
  capturedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface Nis2CatalogEntry {
  key: string;
  title: string;
  shortDescription: string;
  evidenceHints: string[];
  defaultRiskArea: string;
  sourceReference: string;
  version: string;
}

export interface Nis2ControlDetail {
  control: Nis2CatalogEntry;
  assessment: Nis2Assessment | null;
  evidence: Nis2EvidenceLink[];
  overdue: boolean;
  missingEvidence: boolean;
  needsReview: boolean;
  reviewDue: boolean;
  evidenceCount: number;
}

export interface UpdateAssessmentBody {
  status?: AssessmentStatus;
  owner?: string;
  dueDate?: string | null;
  notes?: string;
  lastReviewedAt?: string | null;
}

export interface AddEvidenceBody {
  evidenceType: EvidenceType;
  evidenceRef: string;
  title: string;
  description?: string;
  capturedAt?: string | null;
}

// --- P_NIS2_2: Management-Report ---

export interface Nis2ReportSummary {
  controlsTotal: number;
  byStatus: Partial<Record<AssessmentStatus, number>>;
  evidenceCoverage: number;
  evidenceCoveragePct: number;
  incidentEvidenceTotal: number;
  addressedWithEvidence: number;
  needsReview: number;
  overdue: number;
  missingEvidence: number;
  reviewDue: number;
}

export interface Nis2ReportControl {
  key: string;
  title: string;
  status: AssessmentStatus;
  owner: string;
  dueDate: string | null;
  evidenceCount: number;
  incidentEvidenceCount: number;
  overdue: boolean;
  missingEvidence: boolean;
  needsReview: boolean;
  reviewDue: boolean;
}

export interface Nis2ManagementReport {
  meta: {
    generatedAt: string;
    catalogVersion: string;
    disclaimer: string;
  };
  summary: Nis2ReportSummary;
  controls: Nis2ReportControl[];
}

// --- Interne Response-Typen ---

interface ControlsResponse { data: Nis2ControlRow[]; summary: Nis2Summary; requestId?: string }
interface DetailResponse { data: Nis2ControlDetail; requestId?: string }
interface AssessmentResponse { data: Nis2Assessment; requestId?: string }
interface EvidenceResponse { data: Nis2EvidenceLink; requestId?: string }
interface ReportResponse { data: Nis2ManagementReport; requestId?: string }

// Allowed-Listen (Quelle der Wahrheit ist das Backend; hier für Formulare).
export const ASSESSMENT_STATUSES: AssessmentStatus[] = [
  'not_started', 'in_progress', 'evidence_collected', 'needs_review', 'addressed', 'not_applicable',
];
export const EVIDENCE_TYPES: EvidenceType[] = [
  'ticket', 'audit_event', 'node', 'integration', 'gitops_profile', 'document', 'external_reference', 'other',
];

export const nis2Api = {
  /** GET /nis2/controls — Readiness-Übersicht + Summary. */
  getControls: (opts?: { signal?: AbortSignal }) =>
    api.get<ControlsResponse>('/nis2/controls', undefined, opts),

  /** GET /nis2/assessments/:controlKey — Control-Detail inkl. Evidence. */
  getControlDetail: (controlKey: string, opts?: { signal?: AbortSignal }) =>
    api.get<DetailResponse>(`/nis2/assessments/${controlKey}`, undefined, opts),

  /** PUT /nis2/assessments/:controlKey — Assessment anlegen/aktualisieren (admin). */
  updateAssessment: (controlKey: string, body: UpdateAssessmentBody) =>
    api.put<AssessmentResponse>(`/nis2/assessments/${controlKey}`, body),

  /** POST /nis2/assessments/:controlKey/evidence — Evidence-Link hinzufügen (admin). */
  addEvidence: (controlKey: string, body: AddEvidenceBody) =>
    api.post<EvidenceResponse>(`/nis2/assessments/${controlKey}/evidence`, body),

  /** DELETE /nis2/evidence/:id — Evidence-Link entfernen (admin). */
  removeEvidence: (id: string) =>
    api.del<void>(`/nis2/evidence/${id}`),

  // --- P_NIS2_2 ---

  /** GET /nis2/report — Management-Report (viewer+). */
  getManagementReport: (opts?: { signal?: AbortSignal }) =>
    api.get<ReportResponse>('/nis2/report', undefined, opts),

  /** POST /nis2/controls/:controlKey/incident-evidence — Ticket als Incident-Evidence verknüpfen (admin). */
  linkIncident: (controlKey: string, ticketId: string) =>
    api.post<EvidenceResponse>(`/nis2/controls/${controlKey}/incident-evidence`, { ticketId }),
};
