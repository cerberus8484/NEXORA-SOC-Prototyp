import type { Ticket } from '../../lib/types';

/**
 * Baut die Create-Payload für ein Follow-up-Ticket aus dem Eltern-Ticket.
 *
 * Verknüpft über `parentId` und übernimmt nur den Fall-Kontext
 * (Kunde/Kategorie/Priorität) — niemals Identität (id/ticketNr) oder
 * fallspezifische Notizen/Evidence. Den Rest füllt der Analyst im Editor.
 */
export function buildFollowUpTicket(parent: Ticket): Partial<Ticket> & Record<string, unknown> {
  const ref = parent.ticketNr || parent.id;
  return {
    title: `Follow-up: ${parent.title || ref}`,
    parentId: parent.id,
    customer: parent.customer ?? '',
    category: parent.category ?? '',
    priority: parent.priority ?? 'medium',
    source: 'manual',
    description: `Follow-up zu ${ref}.`,
  };
}
