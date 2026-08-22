// Reine Helfer ohne Seiteneffekte — vollständig testbar ohne DOM oder API.

import type { Notification } from './notificationsApi';

/**
 * Gibt eine deutsche relative Zeitangabe für einen ISO-Timestamp zurück.
 * Zweites Argument `now` erlaubt deterministisches Testen ohne Date.now()-Mock.
 */
export function formatRelativeTime(isoTimestamp: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(isoTimestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'gerade eben';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min.`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `vor ${diffHours} Std.`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'vor 1 Tag';
  return `vor ${diffDays} Tagen`;
}

/**
 * Gibt eine CSS-Custom-Property-Farbe für einen Severity-Wert zurück.
 * Verwendet ausschließlich vorhandene CSS-Variablen des Design-Systems.
 */
export function severityToColor(severity: Notification['severity']): string {
  switch (severity) {
    case 'critical': return 'var(--danger)';
    case 'high':     return 'var(--warning)';
    case 'medium':   return 'var(--accent)';
    case 'low':      return 'var(--success)';
    case 'info':     return 'var(--text-dim)';
  }
}

/**
 * Gibt ein deutsches Label für einen Severity-Wert zurück.
 */
export function severityToLabel(severity: Notification['severity']): string {
  switch (severity) {
    case 'critical': return 'Kritisch';
    case 'high':     return 'Hoch';
    case 'medium':   return 'Mittel';
    case 'low':      return 'Niedrig';
    case 'info':     return 'Info';
  }
}

/**
 * Gibt true zurück wenn ein Kanal aktiv versendet.
 * Bedingung: outboundEnabled=true UND configured=true.
 * Reine Funktion — vollständig testbar, kein I/O.
 */
export function isChannelActive(outboundEnabled: boolean, configured: boolean): boolean {
  return outboundEnabled && configured;
}

/**
 * Formatiert das Ergebnis von POST /notifications/test in eine deutsche Statuszeile.
 * Reine Funktion — kein I/O. Erwartet nur Kanal-IDs bzw. einen skip-Grund (kein Secret).
 */
export function formatTestResult(data: { sent?: string[]; skipped?: string }): string {
  if (data.skipped === 'disabled') return 'Outbound-Versand ist deaktiviert (NOTIFICATIONS_OUTBOUND_ENABLED nicht gesetzt).';
  if (data.skipped === 'no_targets') return 'Kein Outbound-Kanal konfiguriert.';
  if (data.skipped) return `Übersprungen: ${data.skipped}.`;
  const sent = data.sent ?? [];
  if (sent.length === 0) return 'An keinen Kanal gesendet.';
  return `Test gesendet an: ${sent.join(', ')}.`;
}
