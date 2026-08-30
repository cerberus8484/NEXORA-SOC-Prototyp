// Reine Helfer ohne Seiteneffekte — vollständig testbar ohne DOM oder API.

import type { Notification } from './notificationsApi';
import i18n from '../../i18n';

/**
 * Gibt eine deutsche relative Zeitangabe für einen ISO-Timestamp zurück.
 * Zweites Argument `now` erlaubt deterministisches Testen ohne Date.now()-Mock.
 */
export function formatRelativeTime(isoTimestamp: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(isoTimestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return i18n.t('time.justNow');

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return i18n.t('time.minutesAgo', { count: diffMin });

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return i18n.t('time.hoursAgo', { count: diffHours });

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return i18n.t('time.oneDayAgo');
  return i18n.t('time.daysAgo', { count: diffDays });
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
    case 'critical': return i18n.t('common.critical');
    case 'high':     return i18n.t('tickets.priorities.high');
    case 'medium':   return i18n.t('tickets.priorities.medium');
    case 'low':      return i18n.t('tickets.priorities.low');
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
  if (data.skipped === 'disabled') return i18n.t('ui.outboundDeliveryDisabledNotificationsOutboun');
  if (data.skipped === 'no_targets') return i18n.t('text.noOutboundChannelConfigured');
  if (data.skipped) return i18n.t('notifications.skipped', { count: data.skipped });
  const sent = data.sent ?? [];
  if (sent.length === 0) return i18n.t('text.sentNoChannel');
  return `Test gesendet an: ${sent.join(', ')}.`;
}
