import { describe, it, expect } from 'vitest';
import { buildFollowUpTicket } from './followUpModel';
import type { Ticket } from '../../lib/types';

const parent = {
  id: 'p-1',
  ticketNr: 'INC000123',
  title: 'Verdächtiger Login',
  customer: 'ACME',
  category: 'auth',
  priority: 'high',
  notes: 'geheime Fallnotiz',
  state: 'OPEN',
  status: 'assigned',
} as unknown as Ticket;

describe('buildFollowUpTicket', () => {
  it('verlinkt über parentId auf das Eltern-Ticket', () => {
    expect(buildFollowUpTicket(parent).parentId).toBe('p-1');
  });

  it('präfixt den Titel mit "Follow-up:"', () => {
    expect(buildFollowUpTicket(parent).title).toBe('Follow-up: Verdächtiger Login');
  });

  it('nutzt Ticket-Nr als Referenz, wenn der Titel leer ist', () => {
    const out = buildFollowUpTicket({ ...parent, title: '' } as Ticket);
    expect(out.title).toBe('Follow-up: INC000123');
    expect(out.description).toContain('INC000123');
  });

  it('übernimmt nur den Fall-Kontext (Kunde/Kategorie/Priorität) + source=manual', () => {
    const out = buildFollowUpTicket(parent);
    expect(out.customer).toBe('ACME');
    expect(out.category).toBe('auth');
    expect(out.priority).toBe('high');
    expect(out.source).toBe('manual');
  });

  it('überträgt KEINE Identität oder fallspezifische Notizen', () => {
    const out = buildFollowUpTicket(parent);
    expect(out.id).toBeUndefined();
    expect(out.ticketNr).toBeUndefined();
    expect(out.notes).toBeUndefined();
  });
});
