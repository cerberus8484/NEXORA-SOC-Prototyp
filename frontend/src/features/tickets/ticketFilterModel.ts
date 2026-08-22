// Pure Filter-Logik der Ticket-Liste — testbar ohne DOM.
// Backend-Vertrag: listTicketsSchema (state/status/priority/analyst/search/offset/limit),
// analyst ist ein Exakt-Match, search läuft über Titel/Analyst/Ticket-Nr/Offense-ID.

export const PAGE_SIZE = 50;

export interface TicketFilters {
  state: string;
  status: string;
  priority: string;
  /** Quelle (z.B. 'dataplane' = korrelierte Cross-Domain-Vorfälle); '' = alle. */
  source: string;
  /** Nur eigene Tickets (analyst = eigener Anzeigename). */
  mineOnly: boolean;
  search: string;
  offset: number;
}

export const DEFAULT_FILTERS: TicketFilters = {
  state: 'OPEN', status: '', priority: '', source: '', mineOnly: false, search: '', offset: 0,
};

export interface TicketListParams {
  state?: string;
  status?: string;
  priority?: string;
  source?: string;
  analyst?: string;
  search?: string;
  limit: number;
  offset: number;
  sort: string;
  order: string;
}

export function buildTicketListParams(f: TicketFilters, myName: string): TicketListParams {
  const search = f.search.trim();
  return {
    state: f.state || undefined,
    status: f.status || undefined,
    priority: f.priority || undefined,
    source: f.source || undefined,
    // Ohne eigenen Namen wäre analyst='' ein Filter, der nie matcht — dann lieber weglassen.
    analyst: f.mineOnly && myName ? myName : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: f.offset,
    sort: 'updatedAt',
    order: 'desc',
  };
}

/**
 * Params für „alle gefilterten auswählen": gleiche Filter wie die Liste, aber ohne
 * Offset und mit hohem Limit, um alle passenden IDs über die Seitengrenze hinaus zu holen.
 * `limit` ist bewusst begrenzt (Schutz vor unbeschränkten Queries) — siehe SELECT_ALL_LIMIT.
 */
export const SELECT_ALL_LIMIT = 5000;

export function buildSelectAllParams(f: TicketFilters, myName: string): TicketListParams {
  return { ...buildTicketListParams(f, myName), offset: 0, limit: SELECT_ALL_LIMIT };
}

/** True sobald irgendein Filter vom Default abweicht (steuert den Zurücksetzen-Button). */
export function hasActiveFilters(f: TicketFilters): boolean {
  return f.state !== DEFAULT_FILTERS.state || f.status !== '' || f.priority !== ''
    || f.source !== '' || f.mineOnly || f.search.trim() !== '';
}

/** Seitenzahl (1-basiert) aus offset + PAGE_SIZE. */
export function currentPage(offset: number): number {
  return Math.floor(offset / PAGE_SIZE) + 1;
}

/** Gesamtzahl der Seiten — mindestens 1. */
export function totalPages(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
