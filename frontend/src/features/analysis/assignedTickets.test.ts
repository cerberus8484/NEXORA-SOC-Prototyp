import { describe, it, expect } from 'vitest';
import { isAssignedToMe, myTickets, type AnalystIdentity } from './assignedTickets';
import type { Ticket } from '../../lib/types';

const mk = (analyst: string, id = 't'): Pick<Ticket, 'analyst'> & { id: string } => ({ id, analyst });

describe('isAssignedToMe', () => {
  it('matcht, wenn analyst dem Anzeigenamen entspricht', () => {
    const user: AnalystIdentity = { displayName: 'Thorsten', email: 't@nexora.local' };
    expect(isAssignedToMe(mk('Thorsten'), user)).toBe(true);
  });

  it('matcht, wenn analyst der E-Mail entspricht (Name/E-Mail-Mismatch)', () => {
    // Ticket trägt die E-Mail, useAuth liefert primär den Anzeigenamen → muss trotzdem greifen.
    const user: AnalystIdentity = { displayName: 'Thorsten', email: 't@nexora.local' };
    expect(isAssignedToMe(mk('t@nexora.local'), user)).toBe(true);
  });

  it('ist robust gegen Whitespace und Groß-/Kleinschreibung', () => {
    const user: AnalystIdentity = { displayName: 'Thorsten', email: 'T@Nexora.Local' };
    expect(isAssignedToMe(mk('  thorsten  '), user)).toBe(true);
    expect(isAssignedToMe(mk('t@nexora.local'), user)).toBe(true);
  });

  it('matcht NICHT bei fremdem Analyst', () => {
    const user: AnalystIdentity = { displayName: 'Thorsten', email: 't@nexora.local' };
    expect(isAssignedToMe(mk('Alice'), user)).toBe(false);
  });

  it('leerer Analyst (unassigned) matcht nie', () => {
    const user: AnalystIdentity = { displayName: 'Thorsten', email: 't@nexora.local' };
    expect(isAssignedToMe(mk(''), user)).toBe(false);
    expect(isAssignedToMe(mk('   '), user)).toBe(false);
  });

  it('ohne Nutzer-Identität gibt es keinen Treffer', () => {
    expect(isAssignedToMe(mk('Thorsten'), null)).toBe(false);
    expect(isAssignedToMe(mk('Thorsten'), {})).toBe(false);
  });
});

describe('myTickets', () => {
  it('filtert auf zugewiesene Tickets und erhält die Reihenfolge', () => {
    const user: AnalystIdentity = { displayName: 'Thorsten', email: 't@nexora.local' };
    const list = [mk('Alice', 'a'), mk('Thorsten', 'b'), mk('', 'c'), mk('t@nexora.local', 'd')];
    expect(myTickets(list, user).map((t) => t.id)).toEqual(['b', 'd']);
  });

  it('leere Liste bleibt leer', () => {
    expect(myTickets([], { displayName: 'X' })).toEqual([]);
  });
});
