import { describe, it, expect } from 'vitest';
import { isAssignedToMe, myTickets, type AnalystIdentity } from './assignedTickets';
import type { Ticket } from '../../lib/types';

const mk = (analyst: string, id = 't'): Pick<Ticket, 'analyst'> & { id: string } => ({ id, analyst });

describe('isAssignedToMe', () => {
  it('matcht, wenn analyst dem Anzeigenamen entspricht', () => {
    const user: AnalystIdentity = { displayName: 'Example Analyst', email: 'analyst@nexora.local' };
    expect(isAssignedToMe(mk('Example Analyst'), user)).toBe(true);
  });

  it('matcht, wenn analyst der E-Mail entspricht (Name/E-Mail-Mismatch)', () => {
    // Ticket trägt die E-Mail, useAuth liefert primär den Anzeigenamen → muss trotzdem greifen.
    const user: AnalystIdentity = { displayName: 'Example Analyst', email: 'analyst@nexora.local' };
    expect(isAssignedToMe(mk('analyst@nexora.local'), user)).toBe(true);
  });

  it('ist robust gegen Whitespace und Groß-/Kleinschreibung', () => {
    const user: AnalystIdentity = { displayName: 'Example Analyst', email: 'ANALYST@Nexora.Local' };
    expect(isAssignedToMe(mk('  example analyst  '), user)).toBe(true);
    expect(isAssignedToMe(mk('analyst@nexora.local'), user)).toBe(true);
  });

  it('matcht NICHT bei fremdem Analyst', () => {
    const user: AnalystIdentity = { displayName: 'Example Analyst', email: 'analyst@nexora.local' };
    expect(isAssignedToMe(mk('Alice'), user)).toBe(false);
  });

  it('leerer Analyst (unassigned) matcht nie', () => {
    const user: AnalystIdentity = { displayName: 'Example Analyst', email: 'analyst@nexora.local' };
    expect(isAssignedToMe(mk(''), user)).toBe(false);
    expect(isAssignedToMe(mk('   '), user)).toBe(false);
  });

  it('ohne Nutzer-Identität gibt es keinen Treffer', () => {
    expect(isAssignedToMe(mk('Example Analyst'), null)).toBe(false);
    expect(isAssignedToMe(mk('Example Analyst'), {})).toBe(false);
  });
});

describe('myTickets', () => {
  it('filtert auf zugewiesene Tickets und erhält die Reihenfolge', () => {
    const user: AnalystIdentity = { displayName: 'Example Analyst', email: 'analyst@nexora.local' };
    const list = [mk('Alice', 'a'), mk('Example Analyst', 'b'), mk('', 'c'), mk('analyst@nexora.local', 'd')];
    expect(myTickets(list, user).map((t) => t.id)).toEqual(['b', 'd']);
  });

  it('leere Liste bleibt leer', () => {
    expect(myTickets([], { displayName: 'X' })).toEqual([]);
  });
});
