'use strict';

// Slice 3b: CrowdsecProcessor — normalisierter CrowdSec-Alert -> Ticket (idempotent
// pro offenseId crowdsec:alert:<id>). Mock-TicketService, kein Netz/DB.

const { CrowdsecProcessor } = require('../../src/integrations/adapters/crowdsec/CrowdsecProcessor');
const { CrowdsecAdapter }   = require('../../src/integrations/adapters/crowdsec/CrowdsecAdapter');

const ALERT = {
  id: 42,
  scenario: 'crowdsecurity/http-bruteforce',
  message: '5 Versuche',
  events_count: 5,
  created_at: '2026-06-19T22:00:00Z',
  source: { scope: 'Ip', value: '185.10.20.30', as_number: 64500, as_name: 'EvilNet', cn: 'RU' },
  decisions: [{ origin: 'crowdsec', type: 'ban', scope: 'Ip', value: '185.10.20.30', duration: '4h' }],
};

function normalize(alert = ALERT) {
  return new CrowdsecAdapter().normalize(alert);
}

// Mock-TicketService: findOpenByOffense liefert das vorbereitete offene Ticket.
function makeTickets({ open = null } = {}) {
  const created = [];
  const updated = [];
  return {
    created, updated,
    async findOpenByOffense(source, offenseId) {
      return open && open.source === source && open.offenseId === offenseId ? open : null;
    },
    async create(draft) {
      const t = { id: `t-${created.length + 1}`, updatedAt: new Date().toISOString(), ...draft };
      created.push(t);
      return t;
    },
    async update(id, patch) {
      updated.push({ id, patch });
      return { id, ...patch };
    },
  };
}

describe('CrowdsecProcessor', () => {
  test('ohne offenes Ticket → CREATE mit korrektem Draft', async () => {
    const tickets = makeTickets();
    const res = await new CrowdsecProcessor(tickets).process(normalize());

    expect(res.action).toBe('created');
    expect(tickets.created).toHaveLength(1);
    const d = tickets.created[0];
    expect(d.source).toBe('crowdsec');
    expect(d.kind).toBe('alert');
    expect(d.offenseId).toBe('crowdsec:alert:42');
    expect(d.srcIp).toBe('185.10.20.30');
    expect(d.priority).toBe('high');           // bruteforce → high
    expect(d.mitre).toContain('T1110');        // Brute Force
    expect(d.iocs).toContain('185.10.20.30');
    expect(d.logs).toContain('Raw Alert (JSON)');
  });

  test('offenes Ticket derselben Offense (frisch) → UPDATE, alertCount++', async () => {
    const open = {
      id: 't-9', source: 'crowdsec', offenseId: 'crowdsec:alert:42',
      updatedAt: new Date().toISOString(), alertCount: 1, iocs: '1.1.1.1',
    };
    const tickets = makeTickets({ open });
    const res = await new CrowdsecProcessor(tickets).process(normalize());

    expect(res.action).toBe('updated');
    expect(res.ticketId).toBe('t-9');
    expect(res.alertCount).toBe(2);
    expect(tickets.created).toHaveLength(0);
    expect(tickets.updated[0].patch.alertCount).toBe(2);
    // IOCs werden zusammengeführt (bestehende + neue)
    expect(tickets.updated[0].patch.iocs).toContain('1.1.1.1');
    expect(tickets.updated[0].patch.iocs).toContain('185.10.20.30');
  });

  test('offenes Ticket ist zu alt (außerhalb Fenster) → CREATE (Recurrence)', async () => {
    const old = new Date(Date.now() - 48 * 3600_000).toISOString(); // 48h alt, Fenster 24h
    const open = { id: 't-old', source: 'crowdsec', offenseId: 'crowdsec:alert:42', updatedAt: old, alertCount: 3 };
    const tickets = makeTickets({ open });
    const res = await new CrowdsecProcessor(tickets, { windowH: 24 }).process(normalize());

    expect(res.action).toBe('created');
    expect(tickets.created).toHaveLength(1);
  });

  test('Idempotenz: zweiter identischer Alert aktualisiert dasselbe Ticket statt neu', async () => {
    // Simuliert: erstes process() erzeugt Ticket, das beim zweiten als "open" gefunden wird.
    const tickets = makeTickets();
    const proc = new CrowdsecProcessor(tickets);
    const first = await proc.process(normalize());
    // das erstellte Ticket nun als offen registrieren
    const createdTicket = tickets.created[0];
    tickets.findOpenByOffense = async (s, o) => (createdTicket.offenseId === o ? createdTicket : null);

    const second = await proc.process(normalize());
    expect(first.action).toBe('created');
    expect(second.action).toBe('updated');
    expect(second.ticketId).toBe(createdTicket.id);
  });
});
