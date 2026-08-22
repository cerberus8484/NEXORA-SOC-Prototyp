'use strict';

const { WazuhProcessor }           = require('../../src/integrations/adapters/wazuh/WazuhProcessor');
const { IntegrationService }       = require('../../src/integrations/IntegrationService');
const { TicketService }            = require('../../src/services/TicketService');
const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');
const { mapAlertToNormalized }     = require('../../src/integrations/adapters/wazuh/wazuhMapper');

function alert(overrides = {}) {
  return {
    id:        'a1',
    timestamp: '2024-06-01T12:00:00Z',
    rule:      { id: '5503', level: 6, description: 'Login failed' },
    agent:     { id: '001', name: 'web01', ip: '10.0.0.1' },
    data:      { srcip: '185.1.2.3' },
    ...overrides,
  };
}

describe('WazuhProcessor', () => {
  let repo, tickets, proc;

  beforeEach(() => {
    repo    = new InMemoryTicketRepository();
    tickets = new TicketService(repo);
    // minLevel:0 → Level-Filter für diese Mapping-/Dedup-Tests deaktiviert
    proc    = new WazuhProcessor(tickets, { minLevel: 0 });
  });

  test('legt Ticket aus Wazuh-Alert an (state=OPEN, status=assigned, source=wazuh)', async () => {
    const result = await proc.process(mapAlertToNormalized(alert()));
    expect(result.action).toBe('created');

    const ticket = await tickets.findById(result.ticketId);
    expect(ticket.source).toBe('wazuh');
    expect(ticket.state).toBe('OPEN');
    expect(ticket.status).toBe('assigned');
    expect(ticket.priority).toBe('medium');           // Level 6 → medium
    expect(ticket.offenseId).toBe('wazuh:rule:5503:agent:001');
  });

  test('Dedup: gleiche Offense (Rule+Agent) → UPDATE statt zweitem Ticket', async () => {
    const r1 = await proc.process(mapAlertToNormalized(alert({ id: 'a1' })));
    const r2 = await proc.process(mapAlertToNormalized(alert({
      id: 'a2',
      rule: { id: '5503', level: 10, description: 'Login failed (erneut)' },
    })));

    expect(r2.action).toBe('updated');
    expect(r2.ticketId).toBe(r1.ticketId);

    const children = (await tickets.findAll()).data.filter((t) => t.kind === 'alert');
    expect(children.length).toBe(1);                  // genau 1 Child-Offense (dedupliziert)

    const ticket = await tickets.findById(r1.ticketId);
    expect(ticket.priority).toBe('high');             // Level 10 → high, aufgefrischt
    expect(ticket.alertCount).toBe(2);                // Recurrence-Counter hochgezählt
  });

  test('unterschiedliche Agents → eigene Child-Tickets', async () => {
    await proc.process(mapAlertToNormalized(alert({ agent: { id: '001', name: 'a' } })));
    await proc.process(mapAlertToNormalized(alert({ agent: { id: '002', name: 'b' } })));

    const children = (await tickets.findAll()).data.filter((t) => t.kind === 'alert');
    expect(children.length).toBe(2);
  });

  test('nach Schließen erzeugt ein neuer Alert wieder ein Ticket (Recurrence)', async () => {
    const r1 = await proc.process(mapAlertToNormalized(alert()));
    await tickets.update(r1.ticketId, { state: 'CLOSED', closeReason: 'resolved' });

    const r2 = await proc.process(mapAlertToNormalized(alert({ id: 'a3' })));
    expect(r2.action).toBe('created');
    expect(r2.ticketId).not.toBe(r1.ticketId);
  });
});

describe('IntegrationService.startWorker — Ende-zu-Ende', () => {
  test('ingest eines Wazuh-Alerts erzeugt mit laufendem Worker synchron ein Ticket', async () => {
    const svc = new IntegrationService();                          // eigene InMemory-Repo + -Queue
    const tix = new TicketService(new InMemoryTicketRepository());
    await svc.startWorker({ wazuh: new WazuhProcessor(tix, { minLevel: 0 }) });

    const res = await svc.ingest('wazuh', alert(), { ip: '9.9.9.9' });
    expect(res.status).toBe('accepted');

    const children = (await tix.findAll()).data.filter((t) => t.kind === 'alert');
    expect(children.length).toBe(1);
    expect(children[0].source).toBe('wazuh');
    expect(children[0].state).toBe('OPEN');
  });

  test('ohne gestarteten Worker entsteht KEIN Ticket (Regressionsschutz)', async () => {
    const svc = new IntegrationService();
    const tix = new TicketService(new InMemoryTicketRepository());
    // Kein startWorker() → Event bleibt in der Queue
    const res = await svc.ingest('wazuh', alert(), { ip: '9.9.9.9' });
    expect(res.status).toBe('accepted');
    const all = await tix.findAll();
    expect(all.total).toBe(0);
  });
});

describe('WazuhProcessor — Level-Filter & Korrelations-Fenster', () => {
  let tickets;
  beforeEach(() => { tickets = new TicketService(new InMemoryTicketRepository()); });

  test('Alert unter Mindest-Level wird NICHT zu Ticket (Rauschen gefiltert)', async () => {
    const proc = new WazuhProcessor(tickets, { minLevel: 7 });
    const noise = alert({ rule: { id: '67027', level: 3, description: 'A process was created' } });
    const r = await proc.process(mapAlertToNormalized(noise));
    expect(r.action).toBe('skipped');
    expect((await tickets.findAll()).total).toBe(0);
  });

  test('Alert ab Mindest-Level wird zu Ticket', async () => {
    const proc = new WazuhProcessor(tickets, { minLevel: 7 });
    const real = alert({ rule: { id: '5710', level: 10, description: 'sshd: brute force' } });
    const r = await proc.process(mapAlertToNormalized(real));
    expect(r.action).toBe('created');
  });

  test('Default-Schwelle: Level-5-Alert (sshd Brute-Force) wird Ticket, Level-3-Rauschen nicht', async () => {
    const proc = new WazuhProcessor(tickets); // ohne opts → config-Default (5)
    const ssh = alert({ rule: { id: '5710', level: 5, description: 'sshd: Attempt to login using a non-existent user' } });
    const noise = alert({ id: 'n1', rule: { id: '67027', level: 3, description: 'A process was created' } });
    expect((await proc.process(mapAlertToNormalized(ssh))).action).toBe('created');
    expect((await proc.process(mapAlertToNormalized(noise))).action).toBe('skipped');
    const children = (await tickets.findAll()).data.filter((t) => t.kind === 'alert');
    expect(children.length).toBe(1);                  // nur die SSH-Offense, Rauschen gefiltert
  });

  test('Korrelations-Fenster=0 → jeder Alert ein eigenes Child (kein ewiges Dedup)', async () => {
    const proc = new WazuhProcessor(tickets, { minLevel: 0, windowH: 0 });
    await proc.process(mapAlertToNormalized(alert({ id: 'x1' })));
    await proc.process(mapAlertToNormalized(alert({ id: 'x2' })));
    const children = (await tickets.findAll()).data.filter((t) => t.kind === 'alert');
    expect(children.length).toBe(2);
  });

  test('API-Enrichment: Agent-Details landen am Ticket', async () => {
    const apiClient = {
      isEnabled: () => true,
      getAgent: async () => ({ id: '001', name: 'WINCLIENT', ip: '192.168.241.102', status: 'active', group: ['default'], os: { name: 'Windows 10', version: '22H2' } }),
    };
    const proc = new WazuhProcessor(tickets, { minLevel: 0, apiClient });
    const r = await proc.process(mapAlertToNormalized(alert()));
    const ticket = await tickets.findById(r.ticketId);
    expect(ticket.os).toBe('Windows 10 22H2');
    expect(ticket.hostname).toBe('WINCLIENT');
    expect(ticket.assetTag).toBe('wazuh-agent-001');
  });

  test('API-Enrichment fällt sauber aus wenn die API fehlschlägt (kein Abbruch)', async () => {
    const apiClient = { isEnabled: () => true, getAgent: async () => { throw new Error('API down'); } };
    const proc = new WazuhProcessor(tickets, { minLevel: 0, apiClient });
    const r = await proc.process(mapAlertToNormalized(alert()));
    expect(r.action).toBe('created'); // Ticket entsteht trotzdem
  });

  test('API-Enrichment: MAC aus dem Netz-Interface (passend zur Agent-IP) landet am Ticket', async () => {
    const apiClient = {
      isEnabled: () => true,
      getAgent: async () => ({ id: '001', name: 'web01', ip: '10.0.0.1', status: 'active', os: { name: 'Ubuntu', version: '22.04' } }),
      getNetInterfaces: async () => ([
        { name: 'lo',        mac: '00:00:00:00:00:00', ipv4: ['127.0.0.1'] },
        { name: 'Ethernet0', mac: '00:0c:29:ab:cd:ef', ipv4: ['10.0.0.1'] },
      ]),
    };
    const proc = new WazuhProcessor(tickets, { minLevel: 0, apiClient });
    const r = await proc.process(mapAlertToNormalized(alert()));
    const ticket = await tickets.findById(r.ticketId);
    expect(ticket.mac).toBe('00:0c:29:ab:cd:ef'); // Loopback/Null-MAC übersprungen, IP-Match gewinnt
  });

  test('API-Enrichment: realistische netiface (name,mac OHNE ipv4) → erste echte MAC ans Ticket', async () => {
    // So liefert die echte Wazuh-API netiface (kein ipv4-Feld) — Regression zum select-Bug.
    const apiClient = {
      isEnabled: () => true,
      getAgent: async () => ({ id: '001', name: 'DC01', ip: '10.99.99.10', status: 'active', os: { name: 'Windows Server 2022', version: '10.0.20348' } }),
      getNetInterfaces: async () => ([
        { name: 'Loopback Pseudo-Interface 1', mac: '00:00:00:00:00:00' },
        { name: 'Ethernet', mac: 'bc:24:11:7b:45:69' },
      ]),
    };
    const proc = new WazuhProcessor(tickets, { minLevel: 0, apiClient });
    const r = await proc.process(mapAlertToNormalized(alert()));
    const ticket = await tickets.findById(r.ticketId);
    expect(ticket.mac).toBe('bc:24:11:7b:45:69'); // Loopback/Null-MAC übersprungen, erste echte MAC gewinnt
  });

  test('API-Enrichment: ohne getNetInterfaces (alter Stub) bleibt MAC leer, kein Abbruch', async () => {
    const apiClient = {
      isEnabled: () => true,
      getAgent: async () => ({ id: '001', name: 'web01', ip: '10.0.0.1', os: { name: 'Ubuntu', version: '22.04' } }),
    };
    const proc = new WazuhProcessor(tickets, { minLevel: 0, apiClient });
    const r = await proc.process(mapAlertToNormalized(alert()));
    const ticket = await tickets.findById(r.ticketId);
    expect(ticket.os).toBe('Ubuntu 22.04'); // restliches Enrichment läuft
    expect(ticket.mac).toBe('');             // MAC bleibt leer (keine Fake-Daten)
  });
});

describe('WazuhProcessor — Host-Case (Parent/Child)', () => {
  let tickets;
  beforeEach(() => { tickets = new TicketService(new InMemoryTicketRepository()); });

  test('Offense erzeugt Host-Case (Parent) + Child mit parentId', async () => {
    const proc = new WazuhProcessor(tickets, { minLevel: 0 });
    const r = await proc.process(mapAlertToNormalized(alert()));

    const child = await tickets.findById(r.ticketId);
    expect(child.kind).toBe('alert');
    expect(child.parentId).toBeTruthy();

    const parent = await tickets.findById(child.parentId);
    expect(parent.kind).toBe('case');
    expect(parent.offenseId).toBe('wazuh:host:001');
    expect(parent.title).toContain('Host-Case');
  });

  test('zwei Offenses auf demselben Host → EIN Case, zwei Childs', async () => {
    const proc = new WazuhProcessor(tickets, { minLevel: 0 });
    const r1 = await proc.process(mapAlertToNormalized(alert({ rule: { id: '5503', level: 6 } })));
    const r2 = await proc.process(mapAlertToNormalized(alert({ rule: { id: '5710', level: 6 } })));

    const all      = await tickets.findAll();
    const cases    = all.data.filter((t) => t.kind === 'case');
    const children = all.data.filter((t) => t.kind === 'alert');
    expect(cases.length).toBe(1);
    expect(children.length).toBe(2);

    const c1 = await tickets.findById(r1.ticketId);
    const c2 = await tickets.findById(r2.ticketId);
    expect(c1.parentId).toBe(cases[0].id);
    expect(c2.parentId).toBe(cases[0].id);
  });

  test('bestehender Host-Case ohne MAC heilt sich beim nächsten Alert (einmalige Anreicherung)', async () => {
    let netCalls = 0;
    const apiClient = {
      isEnabled: () => true,
      getAgent: async () => ({ id: '001', name: 'web01', ip: '10.0.0.1', os: { name: 'Ubuntu', version: '22.04' } }),
      getNetInterfaces: async () => { netCalls += 1; return [{ name: 'eth0', mac: '00:0c:29:ab:cd:ef', ipv4: ['10.0.0.1'] }]; },
    };
    const proc = new WazuhProcessor(tickets, { minLevel: 0, apiClient });

    const r1 = await proc.process(mapAlertToNormalized(alert({ rule: { id: '5503', level: 6 } })));
    const caseId = (await tickets.findById(r1.ticketId)).parentId;
    expect((await tickets.findById(caseId)).mac).toBe('00:0c:29:ab:cd:ef');

    const callsAfterCreate = netCalls;
    await proc.process(mapAlertToNormalized(alert({ rule: { id: '5710', level: 6 } })));
    // Zweites (distinktes) Alert: nur das neue Child wird angereichert (+1) — der Case
    // hat schon eine MAC und wird NICHT erneut abgefragt (sonst wäre es +2).
    expect(netCalls).toBe(callsAfterCreate + 1);
    expect((await tickets.findById(caseId)).mac).toBe('00:0c:29:ab:cd:ef');
  });

  test('vorhandene elternlose Offense wird beim Case-Anlegen adoptiert', async () => {
    const orphan = await tickets.create({ title: 'Alt', source: 'wazuh', kind: 'alert', offenseId: 'wazuh:rule:9999:agent:001' });
    expect(orphan.parentId).toBeFalsy();

    const proc = new WazuhProcessor(tickets, { minLevel: 0 });
    await proc.process(mapAlertToNormalized(alert())); // Agent 001 → Case entsteht, adoptiert das Orphan

    const adopted = await tickets.findById(orphan.id);
    expect(adopted.parentId).toBeTruthy();
  });
});
