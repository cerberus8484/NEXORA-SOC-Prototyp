// nis2View — reine Anzeige-Logik für NIS2-Readiness + Management-Report (kein React, kein API).

import type { Tone } from '../../components/ui';
import type { AssessmentStatus, EvidenceType, Nis2ControlRow, Nis2ReportSummary, Nis2ReportControl } from './nis2Api';

// Ehrliche Produktsprache — NIE „compliant"/„zertifiziert"/„konform".
export const NIS2_HEADER_TITLE = 'NIS2 Readiness & Evidence';
export const NIS2_HEADER_SUBTITLE = 'Arbeitsunterstützung und Nachweisführung — kein Konformitätsnachweis, keine Zertifizierung, kein Rechtsgutachten.';

const STATUS_LABEL: Record<AssessmentStatus, string> = {
  not_started:        'Nicht begonnen',
  in_progress:        'In Bearbeitung',
  evidence_collected: 'Evidence gesammelt',
  needs_review:       'Review nötig',
  addressed:          'Bearbeitet',
  not_applicable:     'Nicht anwendbar',
};

const STATUS_TONE: Record<AssessmentStatus, Tone> = {
  not_started:        'muted',
  in_progress:        'accent',
  evidence_collected: 'purple',
  needs_review:       'warning',
  addressed:          'success',
  not_applicable:     'muted',
};

const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  ticket:             'Ticket',
  audit_event:        'Audit-Event',
  node:               'Node',
  integration:        'Integration',
  gitops_profile:     'GitOps-Profil',
  document:           'Dokument',
  external_reference: 'Externe Referenz',
  other:              'Sonstiges',
};

export function statusLabel(status: AssessmentStatus): string { return STATUS_LABEL[status] ?? status; }
export function statusTone(status: AssessmentStatus): Tone { return STATUS_TONE[status] ?? 'muted'; }
export function evidenceTypeLabel(t: EvidenceType): string { return EVIDENCE_TYPE_LABEL[t] ?? t; }

// Signal-Spalte: das dringendste ehrliche Signal pro Control (oder „ok").
export interface ControlSignal { tone: Tone; label: string }
export function controlSignal(c: Pick<Nis2ControlRow, 'overdue' | 'needsReview' | 'missingEvidence' | 'reviewDue' | 'status'>): ControlSignal {
  if (c.overdue) return { tone: 'danger', label: 'Überfällig' };
  if (c.needsReview) return { tone: 'warning', label: 'Review nötig' };
  if (c.missingEvidence) return { tone: 'warning', label: 'Keine Evidence' };
  // reviewDue (P_NIS2_3): addressed + Evidence vorhanden, aber Nachweis seit > Kadenz nicht re-reviewed.
  if (c.reviewDue) return { tone: 'warning', label: 'Review fällig' };
  if (c.status === 'not_applicable') return { tone: 'muted', label: 'Nicht anwendbar' };
  return { tone: 'success', label: 'OK' };
}

// „addressed" ohne Evidence ist KEIN vollständiger Nachweis — ehrlicher Hinweis.
export function isAddressedWithoutEvidence(status: AssessmentStatus, evidenceCount: number): boolean {
  return status === 'addressed' && evidenceCount === 0;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// Fortschrittsfarbe für die Coverage-KPI (rein visuell).
export function coverageTone(pct: number): Tone {
  if (pct >= 80) return 'success';
  if (pct >= 40) return 'warning';
  return 'danger';
}

// --- P_NIS2_2: Management-Report-Helfer ---

/**
 * Kanonische Anzeigereihenfolge der Assessment-Status im Management-Report.
 * Dringende/aktive Status zuerst, neutrale zuletzt.
 */
export const STATUS_ORDER: AssessmentStatus[] = [
  'not_started',
  'in_progress',
  'evidence_collected',
  'needs_review',
  'addressed',
  'not_applicable',
];

export interface ReportStatusRow {
  status: AssessmentStatus;
  label: string;
  count: number;
}

/**
 * Erzeugt eine Zeile pro Status in STATUS_ORDER-Reihenfolge.
 * Fehlende byStatus-Keys werden zu 0 normalisiert (nie undefined).
 */
export function reportStatusRows(
  summary: Pick<Nis2ReportSummary, 'byStatus'>,
): ReportStatusRow[] {
  return STATUS_ORDER.map(status => ({
    status,
    label: STATUS_LABEL[status],
    count: summary.byStatus[status] ?? 0,
  }));
}

/**
 * Rein beschreibender Text: wie viele Controls Incident-Tickets als Evidence haben.
 * KEIN Compliance-Claim.
 */
export function incidentCoverageText(
  summary: Pick<Nis2ReportSummary, 'incidentEvidenceTotal' | 'controlsTotal'>,
): string {
  return `${summary.incidentEvidenceTotal} von ${summary.controlsTotal} Controls mit Incident-Nachweis`;
}

/**
 * Kompakte de-Datums-/Zeitausgabe für generatedAt-Zeitstempel.
 * Ungültige oder fehlende Werte → "—".
 */
export function formatGeneratedAt(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Tone für eine einzelne Report-Control-Zeile.
 * Priorisierung: overdue > needsReview/missingEvidence > addressed/in-progress > neutral.
 */
export function reportControlTone(
  c: Pick<Nis2ReportControl, 'overdue' | 'needsReview' | 'missingEvidence' | 'reviewDue' | 'status'>,
): Tone {
  if (c.overdue) return 'danger';
  if (c.needsReview || c.missingEvidence || c.reviewDue) return 'warning';
  if (c.status === 'addressed' || c.status === 'evidence_collected' || c.status === 'in_progress') {
    return 'success';
  }
  return 'muted';
}
