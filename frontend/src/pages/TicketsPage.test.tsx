import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Admin-User (darf löschen) + API mocken — wir prüfen das Verhalten, nicht das echte fetch.
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin', displayName: 'Admin' } }),
}));
vi.mock('../features/tickets/ticketApi', () => ({
  ticketApi: { list: vi.fn(), update: vi.fn(), delete: vi.fn(), bulkDelete: vi.fn() },
}));

import { ticketApi } from '../features/tickets/ticketApi';
import { TicketsPage } from './TicketsPage';

const mockList       = ticketApi.list       as ReturnType<typeof vi.fn>;
const mockBulkDelete = ticketApi.bulkDelete as ReturnType<typeof vi.fn>;

function mkTicket(id: string, nr: string) {
  return { id, ticketNr: nr, title: `Titel ${nr}`, priority: 'medium', state: 'OPEN', status: 'assigned', analyst: '' };
}
function listResult(tickets: ReturnType<typeof mkTicket>[]) {
  return { data: tickets, total: tickets.length };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue(listResult([mkTicket('id-1', 'INC001'), mkTicket('id-2', 'INC002'), mkTicket('id-3', 'INC003')]));
});

// Rendert, wartet aufs Laden und selektiert die ersten beiden Tickets.
async function renderAndSelectTwo() {
  render(<MemoryRouter><TicketsPage /></MemoryRouter>);
  await screen.findByText('Titel INC001');
  fireEvent.click(screen.getByRole('checkbox', { name: /Ticket INC001 auswählen/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: /Ticket INC002 auswählen/i }));
  await screen.findByText('2 ausgewählt');
}

async function openAndConfirmBulkDelete() {
  fireEvent.click(screen.getByRole('button', { name: /Ausgewählte löschen/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Endgültig löschen/i }));
}

describe('TicketsPage — Bulk Delete', () => {
  it('sendet GENAU EINEN Bulk-Request mit allen IDs und lädt danach EINMAL neu', async () => {
    mockBulkDelete.mockResolvedValue({ data: { requested: 2, deleted: 2, missing: 0, deletedIds: ['id-1', 'id-2'] } });
    await renderAndSelectTwo();
    const listCallsBefore = mockList.mock.calls.length;

    await openAndConfirmBulkDelete();

    await waitFor(() => expect(mockBulkDelete).toHaveBeenCalledTimes(1));
    const ids = mockBulkDelete.mock.calls[0][0];
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(['id-1', 'id-2']));
    // genau ein erneutes load() nach Erfolg
    await waitFor(() => expect(mockList.mock.calls.length).toBe(listCallsBefore + 1));
  });

  it('setzt die Auswahl erst NACH Erfolg zurück', async () => {
    mockBulkDelete.mockResolvedValue({ data: { requested: 2, deleted: 2, missing: 0, deletedIds: ['id-1', 'id-2'] } });
    await renderAndSelectTwo();

    await openAndConfirmBulkDelete();

    // Bulk-Leiste verschwindet (Auswahl geleert) — erst nach erfolgreicher Antwort
    await waitFor(() => expect(screen.queryByText('2 ausgewählt')).not.toBeInTheDocument());
  });

  it('zeigt das Teil-Ergebnis ehrlich an (gelöscht + nicht gefunden)', async () => {
    mockBulkDelete.mockResolvedValue({ data: { requested: 2, deleted: 1, missing: 1, deletedIds: ['id-1'] } });
    await renderAndSelectTwo();

    await openAndConfirmBulkDelete();

    expect(await screen.findByText(/1 von 2 gelöscht/i)).toBeInTheDocument();
    expect(screen.getByText(/1 nicht gefunden/i)).toBeInTheDocument();
  });

  it('bei Fehler: sichtbare Meldung, kein Reload, Auswahl bleibt, KEINE Erfolgsmeldung', async () => {
    mockBulkDelete.mockRejectedValue(new Error('Serverfehler 500'));
    await renderAndSelectTwo();
    const listCallsBefore = mockList.mock.calls.length;

    await openAndConfirmBulkDelete();

    expect(await screen.findByText('Serverfehler 500')).toBeInTheDocument();
    // kein erneutes Laden
    expect(mockList.mock.calls.length).toBe(listCallsBefore);
    // Auswahl bleibt erhalten
    expect(screen.getByText('2 ausgewählt')).toBeInTheDocument();
    // keine Erfolgs-/Teil-Erfolgsmeldung (Ergebnis-Banner hat role="status")
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('Einzel-Löschen bleibt verfügbar (keine Regression)', async () => {
    render(<MemoryRouter><TicketsPage /></MemoryRouter>);
    await screen.findByText('Titel INC001');
    // Jede Zeile hat weiterhin ihren eigenen Lösch-Button
    expect(screen.getByRole('button', { name: /Ticket INC001 löschen/i })).toBeInTheDocument();
  });
});
