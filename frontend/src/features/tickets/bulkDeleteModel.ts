import i18n from '../../i18n';
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
    return { text: i18n.t('tickets.bulkNoneDeleted', { missing: r.missing }), tone: 'warn' };
  }
  if (r.missing <= 0) {
    return { text: i18n.t('tickets.bulkDeleted', { count: r.deleted, noun: plural(r.deleted) }), tone: 'ok' };
  }
  return {
    text: i18n.t('tickets.bulkPartial', { deleted: r.deleted, requested: r.requested, missing: r.missing }),
    tone: 'warn',
  };
}
