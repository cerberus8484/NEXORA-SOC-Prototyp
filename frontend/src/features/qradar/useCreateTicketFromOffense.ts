import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ticketApi } from '../tickets/ticketApi';
import { offenseToTicketDraft, type OffenseToTicketOptions } from './qradarTicketModel';
import type { QRadarOffense } from './qradarApi';

/**
 * Erstellt aus einer QRadar-Offense ein Nexora-Ticket (`POST /v1/tickets`) und
 * springt danach ins neue Ticket. Zwei Aufrufer: Report-Tab + Enrichment-Sidebar.
 */
export function useCreateTicketFromOffense() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(offense: QRadarOffense, opts: OffenseToTicketOptions = {}) {
    setBusy(true);
    setError('');
    try {
      const res = await ticketApi.create(offenseToTicketDraft(offense, opts));
      navigate(`/tickets/${res.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ticket-Erstellung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return { create, busy, error };
}
