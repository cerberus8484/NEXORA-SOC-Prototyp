/**
 * Reine Prioritäts-Logik (ohne Seiteneffekte, gut testbar).
 *
 * `markImportantPriority` hebt ein Ticket auf „wichtig" = mindestens `high` —
 * und stuft dabei nie herab (ein bereits `critical`-Ticket bleibt `critical`).
 */
export function markImportantPriority(current: string): string {
  return current === 'critical' ? 'critical' : 'high';
}
