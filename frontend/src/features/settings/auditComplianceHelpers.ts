/**
 * Reine Helfer für AuditCompliancePanel — kein React, keine API-Calls, testbar.
 *
 * Ehrlichkeits-Regel (analog ADR-009):
 *   ECHT: Audit-Aktivität aus /v1/audit, Action-Zähler, Label-Übersetzung.
 *   GEPLANT: Compliance-Report-Export (kein Backend vorhanden).
 *   NIEMALS: Fake-Zertifizierung, Fake-Compliance-Status.
 */
import type { AuditEntry } from '../audit/auditApi';

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
  LOGIN:                'Anmeldung',
  LOGOUT:               'Abmeldung',
  TICKET_CREATE:        'Ticket erstellt',
  TICKET_UPDATE:        'Ticket aktualisiert',
  TICKET_DELETE:        'Ticket gelöscht',
  USER_CREATE:          'Benutzer erstellt',
  USER_UPDATE:          'Benutzer aktualisiert',
  USER_DELETE:          'Benutzer gelöscht',
  HUNT_START:           'Hunt gestartet',
  HUNT_STOP:            'Hunt gestoppt',
  FP_EXCEPTION_CREATE:  'FP-Ausnahme erstellt',
  FP_EXCEPTION_APPLY:   'FP-Ausnahme angewendet',
  AGENT_SUGGESTION:     'KI-Vorschlag erstellt',
  AGENT_APPROVE:        'KI-Vorschlag genehmigt',
  AGENT_REJECT:         'KI-Vorschlag abgelehnt',
  EVIDENCE_CREATE:      'Beweis hinzugefügt',
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
  if (limit === 1) return 'Letzter 1 Eintrag';
  return `Letzte ${limit} Einträge`;
}
