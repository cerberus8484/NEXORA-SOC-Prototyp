// Pure Match-Logik: „Gehört dieses Ticket dem aktuellen Nutzer?"
// Hintergrund (W7): Beim Zuweisen wird `ticket.analyst` mit `displayName || email`
// befüllt (TicketsPage/AnalysisPage). Der Switcher kennt aus useAuth() denselben
// Nutzer — aber Display-Name und E-Mail können je nach Pfad abweichen. Darum wird
// robust gegen BEIDE Identitäten (Anzeigename UND E-Mail) normalisiert verglichen,
// damit „Meine Tickets" auch bei Name/E-Mail-Mismatch zuverlässig greift.

import type { Ticket } from '../../lib/types';

/** Identität des aktuellen Nutzers, soweit für den Match relevant. */
export interface AnalystIdentity {
  displayName?: string;
  email?: string;
}

/** Normalisiert einen Identitätswert: getrimmt + kleingeschrieben. Leeres → ''. */
function norm(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * True, wenn `ticket.analyst` mit dem Anzeigenamen ODER der E-Mail des Nutzers
 * übereinstimmt (normalisiert). Ein leerer Analyst-Wert (unassigned) matcht nie,
 * auch wenn der Nutzer keine Identität hätte — kein Fake-Treffer.
 */
export function isAssignedToMe(ticket: Pick<Ticket, 'analyst'>, user: AnalystIdentity | null | undefined): boolean {
  const assigned = norm(ticket.analyst);
  if (!assigned) return false;
  const candidates = [norm(user?.displayName), norm(user?.email)].filter(Boolean);
  return candidates.includes(assigned);
}

/** Filtert die Liste auf die dem Nutzer zugewiesenen Tickets (Reihenfolge bleibt erhalten). */
export function myTickets<T extends Pick<Ticket, 'analyst'>>(tickets: readonly T[], user: AnalystIdentity | null | undefined): T[] {
  return tickets.filter((t) => isAssignedToMe(t, user));
}
