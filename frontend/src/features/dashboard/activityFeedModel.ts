/**
 * Reine Mapping-Helfer für den Dashboard-Activity-Feed.
 * Kein JSX, kein DOM — testbar in Vitest ohne jsdom-Setup.
 *
 * Die Icon-Komponenten (JSX) bleiben in DashboardPage.tsx, da sie
 * React-Abhängigkeiten haben. Hier leben nur die reinen Label- und
 * Zeit-Funktionen.
 */

/** Bekannte Audit-Aktionen → deutscher Label. */
import i18n from '../../i18n';

export const KNOWN_ACTIONS: Readonly<Record<string, string>> = {
  TICKET_CREATE:    i18n.t('audit.ticketCreated'),
  TICKET_UPDATE:    i18n.t('audit.ticketUpdated'),
  TICKET_DELETE:    i18n.t('settings.ticketDeleted'),
  'evidence.create':  'Evidence gesichert',
  'evidence.custody': 'Evidence reviewed',
  LOGIN:            'Login',
};

/**
 * Gibt den deutschen Label für eine Audit-Aktion zurück.
 * Unbekannte Aktionen werden unverändert zurückgegeben (Fallback = raw action).
 */
export function resolveActionLabel(action: string): string {
  return KNOWN_ACTIONS[action] ?? action;
}

/**
 * Gibt einen menschenlesbaren relativen Zeitstempel zurück.
 * Zeitstempel in der Zukunft oder ungültige Werte → "gerade eben".
 */
export function relTime(iso: string): string {
  const parsed = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - (Number.isNaN(parsed) ? Date.now() : parsed)) / 1000);
  if (s < 60) return i18n.t('time.justNow');
  if (s < 3_600) return i18n.t('time.minutesAgoShort', { count: Math.floor(s / 60) });
  if (s < 86_400) return i18n.t('time.hoursAgoShort', { count: Math.floor(s / 3_600) });
  return i18n.t('time.daysAgoShort', { count: Math.floor(s / 86_400) });
}
