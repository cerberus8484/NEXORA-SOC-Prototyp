// Pure Logik für die ehrliche Ergebnis-Anzeige der Bulk-Löschung — testbar ohne DOM.
// Backend-Vertrag: POST /tickets/bulk-delete → { requested, deleted, missing, deletedIds }.

export interface BulkDeleteResult {
  requested: number;
  deleted: number;
  missing: number;
  deletedIds: string[];
}

export interface BulkDeleteNotice {
  text: string;
  /** 'ok' = alles gelöscht; 'warn' = nichts oder nur teilweise gelöscht. */
  tone: 'ok' | 'warn';
}

function plural(n: number): string {
  return n === 1 ? 'Ticket' : 'Tickets';
}

/**
 * Ehrliche Ergebnis-Meldung — NIE „Erfolg" für nicht gelöschte Tickets.
 * - alles gelöscht        → ok
 * - nichts gelöscht       → warn (kein Erfolgswording)
 * - teilweise gelöscht    → warn, nennt gelöscht + nicht gefunden getrennt
 */
export function formatBulkDeleteResult(r: BulkDeleteResult): BulkDeleteNotice {
  if (r.deleted <= 0) {
    return { text: `Kein Ticket gelöscht — ${r.missing} nicht gefunden (bereits entfernt).`, tone: 'warn' };
  }
  if (r.missing <= 0) {
    return { text: `${r.deleted} ${plural(r.deleted)} gelöscht.`, tone: 'ok' };
  }
  return {
    text: `${r.deleted} von ${r.requested} gelöscht — ${r.missing} nicht gefunden (bereits entfernt).`,
    tone: 'warn',
  };
}
