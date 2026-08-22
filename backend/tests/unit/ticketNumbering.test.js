'use strict';

const { TicketService } = require('../../src/services/TicketService');
const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');

function svc() { return new TicketService(new InMemoryTicketRepository()); }

describe('Ticket-Nummerierung (INC######)', () => {
  it('vergibt fortlaufende INC-Nummern', async () => {
    const s = svc();
    const a = await s.create({ title: 'A', priority: 'high' });
    const b = await s.create({ title: 'B', priority: 'low' });
    expect(a.ticketNr).toBe('INC000001');
    expect(b.ticketNr).toBe('INC000002');
  });

  it('respektiert vorgegebene ticketNr', async () => {
    const s = svc();
    const t = await s.create({ title: 'X', ticketNr: 'INC999999' });
    expect(t.ticketNr).toBe('INC999999');
  });
});
