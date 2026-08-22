/**
 * Reine Mapping-Helfer für den Dashboard-Activity-Feed.
 * Kein JSX, kein DOM — testbar in Vitest ohne jsdom-Setup.
 *
 * Die Icon-Komponenten (JSX) bleiben in DashboardPage.tsx, da sie
 * React-Abhängigkeiten haben. Hier leben nur die reinen Label- und
 * Zeit-Funktionen.
 */

/** Bekannte Audit-Aktionen → deutscher Label. */
export const KNOWN_ACTIONS: Readonly<Record<string, string>> = {
  TICKET_CREATE:    'Ticket erstellt',
  TICKET_UPDATE:    'Ticket aktualisiert',
  TICKET_DELETE:    'Ticket gelöscht',
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
  if (s < 60) return 'gerade eben';
  if (s < 3_600) return `vor ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `vor ${Math.floor(s / 3_600)} h`;
  return `vor ${Math.floor(s / 86_400)} d`;
}
