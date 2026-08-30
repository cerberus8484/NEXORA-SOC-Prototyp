/**
 * Reine Helfer für AuditCompliancePanel — kein React, keine API-Calls, testbar.
 *
 * Ehrlichkeits-Regel (analog ADR-009):
 *   ECHT: Audit-Aktivität aus /v1/audit, Action-Zähler, Label-Übersetzung.
 *   GEPLANT: Compliance-Report-Export (kein Backend vorhanden).
 *   NIEMALS: Fake-Zertifizierung, Fake-Compliance-Status.
 */
import type { AuditEntry } from '../audit/auditApi';
import i18n from '../../i18n';

// ── countByAction ─────────────────────────────────────────────────────────────

/**
 * Zählt Audit-Einträge je Action-Typ.
 * Gibt ein Objekt { [action]: count } zurück.
 * Mutiert das Eingabe-Array nicht.
 */
export function countByAction(entries: AuditEntry[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((acc, entry) => {
    const prev = acc[entry.action] ?? 0;
    return { ...acc, [entry.action]: prev + 1 };
  }, {});
}

// ── actionLabel ───────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  LOGIN:                i18n.t('audit.login'),
  LOGOUT:               i18n.t('audit.logout'),
  TICKET_CREATE:        i18n.t('audit.ticketCreated'),
  TICKET_UPDATE:        i18n.t('audit.ticketUpdated'),
  TICKET_DELETE:        i18n.t('settings.ticketDeleted'),
  USER_CREATE:          i18n.t('audit.userCreated'),
  USER_UPDATE:          i18n.t('audit.userUpdated'),
  USER_DELETE:          i18n.t('settings.userDeleted'),
  HUNT_START:           'Hunt gestartet',
  HUNT_STOP:            'Hunt gestoppt',
  FP_EXCEPTION_CREATE:  i18n.t('audit.fpExceptionCreated'),
  FP_EXCEPTION_APPLY:   i18n.t('audit.fpExceptionApplied'),
  AGENT_SUGGESTION:     i18n.t('audit.aiSuggestionCreated'),
  AGENT_APPROVE:        i18n.t('audit.aiSuggestionApproved'),
  AGENT_REJECT:         i18n.t('audit.aiSuggestionRejected'),
  EVIDENCE_CREATE:      i18n.t('settings.evidenceAdded'),
  YARA_SCAN:            'YARA-Scan gestartet',
};

/**
 * Liefert einen deutschen Anzeigenamen für einen Action-Code.
 * Unbekannte Codes werden unverändert zurückgegeben.
 */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// ── recentWindowLabel ─────────────────────────────────────────────────────────

/**
 * Erzeugt eine menschenlesbare Bezeichnung für das Abfrage-Fenster.
 * Unterscheidet Singular (1 Eintrag) von Plural (n Einträge).
 */
export function recentWindowLabel(limit: number): string {
  if (limit === 1) return i18n.t('settings.lastOneEntry');
  return i18n.t('settings.lastNEntries', { count: limit });
}
