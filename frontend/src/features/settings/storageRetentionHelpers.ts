/**
 * Reine Helfer für StorageRetentionPanel — kein React, keine API-Calls, testbar.
 *
 * ADR-009: Keine S3/Glacier/Tiering-Fiktion — nur echte PostgreSQL-Daten.
 */

// ── formatBytes ───────────────────────────────────────────────────────────────

/** Bytes menschenlesbar (B/KB/MB/GB/TB, Basis 1024). Kein Buffer, kein Node. */
import i18n from '../../i18n';

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1)} ${units[i]}`;
}

// ── tableLabel ────────────────────────────────────────────────────────────────

const TABLE_LABELS: Record<string, string> = {
  tickets:       'Tickets',
  evidence:      'Beweise',
  audit_log:     'Audit-Log',
  hunt_sessions: 'Hunt-Sessions',
  notifications: i18n.t('nav.notifications'),
  users:         i18n.t('common.users'),
  fp_exceptions: 'FP-Ausnahmen',
  findings:      'Findings',
  agent_suggestions: i18n.t('settings.aiSuggestions'),
};

/** Freundlicher Anzeigename für eine Datenbankiabelle. */
export function tableLabel(name: string): string {
  return TABLE_LABELS[name] ?? name;
}

// ── tableShare ────────────────────────────────────────────────────────────────

/**
 * Prozentualer Anteil einer Tabelle an der Gesamtgröße.
 * Gibt eine ganze Zahl (0–100) zurück.
 */
export function tableShare(tableBytes: number, totalBytes: number): number {
  if (totalBytes <= 0 || tableBytes <= 0) return 0;
  return Math.min(100, Math.round((tableBytes / totalBytes) * 100));
}

// ── totalRecords ──────────────────────────────────────────────────────────────

type PartialCounts = Record<string, number> | undefined;

/** Summiert alle Datensatz-Zahlen aus dem `counts`-Objekt der Stats-API. */
export function totalRecords(counts: PartialCounts): number {
  if (!counts) return 0;
  return Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);
}
