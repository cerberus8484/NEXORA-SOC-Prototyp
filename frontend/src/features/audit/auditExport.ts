// CSV-Export für das Audit-Log (P_AUDIT_EXPORT). Reine Logik — kein DOM, gut testbar.
// Der Download-Trigger liegt in der Seite; hier nur die korrekte CSV-Serialisierung.

import type { AuditEntry } from './auditApi';

export const AUDIT_CSV_COLUMNS = [
  'createdAt', 'action', 'actorLabel', 'targetType', 'targetId', 'ip', 'metadata',
] as const;

/**
 * Escapet ein einzelnes CSV-Feld (RFC-4180): Felder mit `,` `"` Zeilenumbruch
 * werden in Anführungszeichen gesetzt, enthaltene `"` verdoppelt.
 *
 * **CSV-Injection-Schutz (OWASP):** beginnt ein Wert mit `= + - @` oder einem
 * Tab/CR, wird ein `'` vorangestellt — so führt Excel/Sheets es nicht als Formel
 * aus (z. B. Audit-Metadaten, die mit `=` beginnen).
 */
export function escapeCsvField(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialisiert Audit-Einträge nach CSV (Header + eine Zeile je Eintrag, CRLF). */
export function auditEntriesToCsv(entries: AuditEntry[]): string {
  const header = AUDIT_CSV_COLUMNS.join(',');
  const rows = entries.map((e) =>
    [
      e.createdAt, e.action, e.actorLabel, e.targetType, e.targetId, e.ip,
      JSON.stringify(e.metadata ?? {}),
    ]
      .map(escapeCsvField)
      .join(','),
  );
  return [header, ...rows].join('\r\n');
}

/** Stabiler Dateiname mit Zeitstempel, z. B. `nexora-audit-20260619-1530.csv`. */
export function auditCsvFilename(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `nexora-audit-${ts}.csv`;
}
