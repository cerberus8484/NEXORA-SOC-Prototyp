'use strict';

// Restart-Festigkeit der Splunk-Dedup (#3b).
//
// Bug-Repro: SplunkProcessor dedupte über eine prozess-lokale RAM-Map. Nach einem
// API-Neustart (neue Processor-Instanz) war diese Map leer → ein zweites identisches
// Splunk-Event legte ein DUPLIKAT-Ticket an. Der Fix stellt den Dedup auf den
// DB-basierten Pfad um (ticketService.findOpenByOffense('splunk', …)), genau wie
// QRadar/Email. Dieser Test fängt einen Rückfall ab.

const { SplunkAdapter }   = require('../../src/integrations/adapters/splunk/SplunkAdapter');
const { SplunkProcessor } = require('../../src/integrations/adapters/splunk/SplunkProcessor');
const { ticketService }   = require('../../src/services/TicketService');
const { auditService }    = require('../../src/services/AuditService');

const adapter = new SplunkAdapter();

const VALID_ALERT = {
  sid: '1748952000.12345',
  search_name: 'PowerShell C2 Beacon Detection',
  result: {
    event_id:  'c35a4b2d-88f1-4e3a-9b12-0a5e7f8d2c91@@notable@@1748952000',
    rule_name: 'PowerShell C2 Beacon Detection',
    rule_title:'Suspicious PowerShell Outbound Traffic',
    urgency:   'high',
    _time:     1748952000,
    src:       '192.168.243.45',
    dest:      '185.220.101.47',
    description: 'Outbound HTTPS connection to known C2 IP',
  },
};

beforeEach(() => {
  ticketService._repo.clear();
  auditService.clearLog();
});

describe('Splunk-Dedup überlebt API-Neustart', () => {
  test('zweites identisches Event nach „Neustart" (neue Processor-Instanz) → KEIN Duplikat', async () => {
    const normalized = adapter.normalize(VALID_ALERT);

    // Erste Instanz erstellt das Ticket.
    const before = new SplunkProcessor();
    const r1 = await before.process(normalized);
    expect(r1.action).toBe('created');

    // „Neustart": komplett neue Processor-Instanz, KEIN geteilter RAM-State.
    const after = new SplunkProcessor();
    const r2 = await after.process(normalized);

    expect(r2.action).toBe('updated');
    expect(r2.ticketId).toBe(r1.ticketId);

    const tickets = (await ticketService.findAll()).data;
    expect(tickets.length).toBe(1);
  });
});
