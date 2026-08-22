// Reine Ableitung der Header-Kennzahlen aus der geladenen Ticket-Liste — testbar ohne DOM.
// Liefert: offene Tickets, zugewiesen vs. unzugewiesen, Prioritätsverteilung.
// Bewusst aus der bereits geladenen Liste abgeleitet (kein zusätzlicher Endpoint) —
// die Werte beschreiben damit ehrlich nur die aktuell sichtbare/gefilterte Seite.

import type { Ticket } from '../../lib/types';

export type PriorityKey = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Stabile Reihenfolge für die Anzeige der Prioritäts-Badges. */
export const PRIORITY_ORDER: readonly PriorityKey[] = ['critical', 'high', 'medium', 'low', 'info'];

export interface TicketsHeaderStats {
  total: number;
  open: number;
  assigned: number;
  unassigned: number;
  priority: Record<PriorityKey, number>;
}

const KNOWN_PRIORITIES = new Set<PriorityKey>(PRIORITY_ORDER);

/** Normalisiert einen rohen Priority-String auf einen bekannten Key; Unbekanntes → 'info'. */
function priorityKey(raw: string): PriorityKey {
  const v = raw.trim().toLowerCase() as PriorityKey;
  return KNOWN_PRIORITIES.has(v) ? v : 'info';
}

/** True, wenn das Ticket offen ist. Fehlender state wird wie 'OPEN' behandelt (Backend-Default). */
function isOpen(t: Ticket): boolean {
  return (t.state ?? 'OPEN') === 'OPEN';
}

/** Leitet die Header-Kennzahlen aus der geladenen Liste ab. */
export function computeHeaderStats(tickets: readonly Ticket[]): TicketsHeaderStats {
  const priority: Record<PriorityKey, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let open = 0;
  let assigned = 0;

  for (const t of tickets) {
    if (isOpen(t)) open += 1;
    if (t.analyst.trim() !== '') assigned += 1;
    priority[priorityKey(t.priority)] += 1;
  }

  return {
    total: tickets.length,
    open,
    assigned,
    unassigned: tickets.length - assigned,
    priority,
  };
}
