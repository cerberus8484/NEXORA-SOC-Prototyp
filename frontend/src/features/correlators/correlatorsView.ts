// correlatorsView — reine Anzeige-Logik fürs Correlation Operations Center.
// Kein React, kein API → gut testbar (Projekt-Konvention). Leitet Töne/Labels,
// die „approved ≠ applied"-Aussage, die superseded-Erklärung und RBAC-Sicht ab.

import type { Tone } from '../../components/ui';
import type { PresentationStatus, RiskClass, QueueSummary, DraftView, ValidationResult, ApplyPlan, ApplyStatus, WorkerHealth } from './correlatorsApi';
import { can } from '../../lib/rbac';

// ── Job-Status: Töne + Labels (superseded ist KEIN Fehler) ───────────────────

const JOB_TONE: Record<PresentationStatus, Tone> = {
  pending: 'muted',
  running: 'accent',
  retrying: 'warning',
  completed: 'success',
  failed: 'danger',
  superseded: 'warning',
};

const JOB_LABEL: Record<PresentationStatus, string> = {
  pending: 'Wartet',
  running: 'Läuft',
  retrying: 'Wiederholung',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  superseded: 'Ersetzt',
};

export function jobStatusTone(status: PresentationStatus): Tone {
  return JOB_TONE[status] ?? 'muted';
}

export function jobStatusLabel(status: PresentationStatus): string {
  return JOB_LABEL[status] ?? status;
}

// ── Risikoklassen ────────────────────────────────────────────────────────────

const RISK_TONE: Record<RiskClass, Tone> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  prohibited: 'danger',
};

const RISK_LABEL: Record<RiskClass, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  prohibited: 'Gesperrt',
};

export function riskTone(risk: RiskClass): Tone {
  return RISK_TONE[risk] ?? 'muted';
}

export function riskLabel(risk: RiskClass): string {
  return RISK_LABEL[risk] ?? risk;
}

// ── approved ≠ applied ───────────────────────────────────────────────────────

export function isApproved(draft: Pick<DraftView, 'status'>): boolean {
  return draft.status === 'approved';
}

/** Klartext-Hinweis: genehmigt, aber NICHT angewendet (kein Apply-Kanal in Slice 1). */
export function approvedNotAppliedNotice(): string {
  return 'Genehmigt, aber noch nicht angewendet. Ein kontrollierter Apply-Kanal ist noch nicht implementiert.';
}

/** Erklärt „superseded" als durch neuere Ticket-Revision ersetzt — kein Fehler. */
export function supersededExplanation(): string {
  return 'Die Eingabedaten haben sich während der Berechnung geändert. Das Ergebnis wurde durch eine neuere Ticket-Revision ersetzt — die Korrelation läuft mit dem aktuellen Stand neu.';
}

// ── RBAC-Sicht (Render-Gate; echte Durchsetzung serverseitig) ────────────────

export function canReadCorrelators(role: string | undefined): boolean {
  return can.act(role); // analyst+
}

export function canEditConfig(role: string | undefined): boolean {
  return can.apply(role); // engineer+
}

export function canDecideConfig(role: string | undefined): boolean {
  return can.admin(role); // admin
}

// ── Reservierte/gesperrte Capabilities (sichtbar, nicht editierbar) ──────────

export function isReservedCapability(cap: { editable: boolean; risk: RiskClass }): boolean {
  return cap.editable === false || cap.risk === 'prohibited';
}

// ── Queue-Kopfzeile ──────────────────────────────────────────────────────────

export function queueHeadline(q: QueueSummary): string {
  return `${q.active} aktiv · ${q.completed} abgeschlossen · ${q.failed} fehlgeschlagen · ${q.superseded} ersetzt`;
}

// ── Redigierter Vorher/Nachher-Diff (für Draft-Anzeige) ──────────────────────

export interface DiffEntry { key: string; before: unknown; after: unknown }

/** Listet je geändertem Feld before/after. Werte sind bereits redigiert (Server). */
export function diffEntries(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): DiffEntry[] {
  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: DiffEntry[] = [];
  for (const key of keys) {
    const b = before ? before[key] : undefined;
    const a = after ? after[key] : undefined;
    if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ key, before: b, after: a });
  }
  return out;
}

// ── Validierung + Apply-Plan-Vorschau (P_CORR_ADMIN_2 Stufe 1, KEIN Apply) ───

/** Kurzfassung eines Validierungsergebnisses für die UI. */
export function validationSummary(result: ValidationResult): string {
  return result.valid ? 'Validierung erfolgreich.' : `Validierung fehlgeschlagen: ${result.errors.join('; ')}`;
}

/** Eligibility-Badge: darf die Capability SPÄTER mal angewendet werden? */
export function eligibilityLabel(plan: Pick<ApplyPlan, 'applyEligible'>): string {
  return plan.applyEligible ? 'Apply-fähig (später)' : 'Nicht anwendbar';
}
export function eligibilityTone(plan: Pick<ApplyPlan, 'applyEligible'>): Tone {
  return plan.applyEligible ? 'accent' : 'muted';
}

/** Klartext-Hinweis am Plan: es wird NICHTS angewendet. */
export function planNoApplyNotice(plan: Pick<ApplyPlan, 'applyImpact'>): string {
  return `Vorschau — es wird nichts angewendet (kein kontrollierter Apply-Kanal in dieser Stufe). `
    + `Erwarteter Service-Impact bei einer späteren Anwendung: ${plan.applyImpact}.`;
}

// ── Apply-Gate-Status (P_CORR_ADMIN_2 Stufe 2) ───────────────────────────────
// applyStatus kommt vom Server: 'supported' nur wenn apply-eligible UND der globale
// Kill-Switch (CONFIG_APPLY_ENABLED) an ist. Sonst klar „serverseitig gesperrt".

export function applyGateLabel(applyStatus: ApplyStatus): string {
  return applyStatus === 'supported'
    ? 'Apply serverseitig freigegeben (admin + Reauth nötig)'
    : 'Apply serverseitig gesperrt';
}
export function applyGateTone(applyStatus: ApplyStatus): Tone {
  return applyStatus === 'supported' ? 'warning' : 'muted';
}

// ── Worker Live-Health (P_CORR_ADMIN_2 Stufe 3) — ehrliche Read-only-Anzeige ──

export function heartbeatLabel(h: Pick<WorkerHealth, 'present' | 'heartbeatFresh'>): string {
  if (!h.present) return 'unbekannt';
  return h.heartbeatFresh ? 'frisch' : 'veraltet';
}
export function heartbeatTone(h: Pick<WorkerHealth, 'present' | 'heartbeatFresh'>): Tone {
  if (!h.present) return 'muted';
  return h.heartbeatFresh ? 'success' : 'danger';
}

const QUEUE_LABELS: Record<string, string> = {
  processing: 'verarbeitet', idle: 'bereit (idle)', stalled: 'Stall', error: 'Fehler', unknown: 'unbekannt',
};
export function queueStateLabel(state: string): string { return QUEUE_LABELS[state] ?? state; }
export function queueStateTone(h: Pick<WorkerHealth, 'queueOk'>): Tone { return h.queueOk ? 'success' : 'danger'; }

/** Apply-Readiness — fail-closed: blockiert, bis alle Live-Signale + Kill-Switch da sind. */
export function applyReadinessLabel(h: WorkerHealth): string {
  return h.applyReady
    ? 'Apply-Ready: alle Live-Health-Signale vorhanden'
    : `Apply blockiert: ${h.reasons.join(' · ') || 'Live-Health unvollständig'}`;
}
export function applyReadinessTone(h: Pick<WorkerHealth, 'applyReady'>): Tone {
  return h.applyReady ? 'warning' : 'muted';
}
