'use strict';

// Testet das Feldmapping ohne echte Datenbankverbindung.
// Prüft: toRow(fromRow(x)) === x (Roundtrip-Invariante)

const { PostgresTicketRepository, FLAT_FIELDS, JSONB_GROUPS, sortColumn } = require('../../src/repositories/PostgresTicketRepository');
const { Ticket } = require('../../src/domain/Ticket');

const repo = new PostgresTicketRepository();

describe('PostgresTicketRepository — sortColumn (Whitelist gegen Bug + Injection)', () => {
  test('mappt camelCase auf echte snake_case-Spalte', () => {
    expect(sortColumn('createdAt')).toBe('created_at');   // war der 500er-Bug
    expect(sortColumn('updatedAt')).toBe('updated_at');
  });
  test('akzeptiert auch snake_case-Eingabe', () => {
    expect(sortColumn('created_at')).toBe('created_at');
  });
  test('erlaubte Felder bleiben', () => {
    expect(sortColumn('priority')).toBe('priority');
    expect(sortColumn('status')).toBe('status');
    expect(sortColumn('title')).toBe('title');
  });
  test('unbekannte/böse Eingabe → sicherer Default created_at (keine Injection)', () => {
    expect(sortColumn('id; DROP TABLE tickets;--')).toBe('created_at');
    expect(sortColumn(undefined)).toBe('created_at');
    expect(sortColumn('')).toBe('created_at');
  });
});

// Vollständiges Test-Ticket mit allen Feldern
const FULL_TICKET = Ticket.create({
  ticketNr:    'INC-2026-00842',
  offenseId:   'OFF-009134',
  title:       'Suspicious PowerShell C2 Beacon',
  category:    'C2 Communication',
  useCase:     'UC-017',
  priority:    'high',
  state:       'CLOSED',
  status:      'in_progress',
  closeReason: 'resolved',
  analyst:     'j.mueller',
  source:      'qradar',
  datetime:    '2026-06-03T14:05:00.000Z',
  // Identity
  user:        'CORP\\jdoe',
  email:       'j.doe@firma.de',
  dept:        'Finance',
  manager:     'A. Schmidt',
  userType:    'Standard User',
  accStatus:   'Active',
  // Network
  srcIp:       '192.168.243.45',
  srcFqdn:     'PC-FIN-045.corp.local',
  dstIp:       '185.220.101.47',
  dstFqdn:     'cdn-update.fastnetwork.ru',
  extIp:       '185.220.101.47',
  extFqdn:     'cdn-update.fastnetwork.ru',
  mac:         'B4:2E:99:1A:3C:F0',
  hostname:    'PC-FIN-045',
  network:     '192.168.243.0/24',
  port:        '443',
  protocol:    'TCP',
  vpn:         'VPN-HQ-01',
  bytesSent:   '2.1 MB',
  bytesRecv:   '840 KB',
  pktsSent:    '12',
  pktsRecv:    '9',
  firewallAction: 'block',
  firstSeen:   '2026-06-03T14:00:00.000Z',
  lastSeen:    '2026-06-03T14:05:00.000Z',
  eventCount:  '4',
  postNatSrc:  '10.0.0.1',
  postNatSrcFqdn: 'fw-nat-gw.corp.local',
  postNatDst:  '185.220.101.47',
  postNatDstFqdn: '',
  // Asset
  os:          'Windows 10 Pro 22H2',
  assetTag:    'ASSET-10045',
  criticality: 'High',
  process:     'powershell.exe',
  hash:        'a3f1c2d8e4b9074512fcd3a1e8b07245',
  mitre:       'T1059.001',
  // Analysis
  description: 'Verdächtiger HTTPS-Traffic zu 185.220.101.47 erkannt.',
  iocs:        '185.220.101.47\nsvcupdate.ps1',
  logs:        'QRadar OFF-009134',
  actions:     '14:12 UTC Endpoint isoliert',
  recommendation: 'Forensische Analyse',
  notes:       'Interne Notiz',
});

describe('PostgresTicketRepository — FIELD_MAP', () => {

  test('FLAT_FIELDS und JSONB_GROUPS sind vollständig definiert', () => {
    expect(FLAT_FIELDS.length).toBeGreaterThan(5);
    expect(Object.keys(JSONB_GROUPS)).toEqual(
      expect.arrayContaining(['identity','network','asset','analysis'])
    );
  });

  test('_toRow() erzeugt Row mit allen DB-Spalten', () => {
    const row = repo._toRow(FULL_TICKET);
    expect(row.id).toBe(FULL_TICKET.id);
    expect(row.title).toBe('Suspicious PowerShell C2 Beacon');
    expect(row.ticket_number).toBe('INC-2026-00842');
    expect(row.offense_id).toBe('OFF-009134');
    expect(row.priority).toBe('high');
    // JSONB-Gruppen als String gespeichert
    expect(typeof row.identity).toBe('string');
    expect(typeof row.network).toBe('string');
    const network = JSON.parse(row.network);
    expect(network.srcIp).toBe('192.168.243.45');
    expect(network.srcFqdn).toBe('PC-FIN-045.corp.local');
    // Flow-Statistik-Felder (App-Map) im selben network-JSONB — keine Migration nötig.
    expect(network.pktsSent).toBe('12');
    expect(network.pktsRecv).toBe('9');
    expect(network.firewallAction).toBe('block');
    expect(network.firstSeen).toBe('2026-06-03T14:00:00.000Z');
    expect(network.lastSeen).toBe('2026-06-03T14:05:00.000Z');
    expect(network.eventCount).toBe('4');
  });

  test('_fromRow() rekonstruiert Ticket aus DB-Row', () => {
    const row = repo._toRow(FULL_TICKET);
    // DB gibt JSONB als Objekt zurück (nicht als String)
    row.identity  = JSON.parse(row.identity);
    row.network   = JSON.parse(row.network);
    row.asset     = JSON.parse(row.asset);
    row.analysis  = JSON.parse(row.analysis);
    row.payloads  = JSON.parse(row.payloads);
    row.evidence  = JSON.parse(row.evidence);
    row.external_links = JSON.parse(row.external_links);
    row.created_at = { toISOString: () => FULL_TICKET.createdAt };
    row.updated_at = { toISOString: () => FULL_TICKET.updatedAt };
    row.occurred_at = { toISOString: () => FULL_TICKET.datetime };

    const ticket = repo._fromRow(row);
    expect(ticket).toBeInstanceOf(Ticket);
    expect(ticket.title).toBe('Suspicious PowerShell C2 Beacon');
    expect(ticket.srcIp).toBe('192.168.243.45');
    expect(ticket.srcFqdn).toBe('PC-FIN-045.corp.local');
    expect(ticket.description).toBe('Verdächtiger HTTPS-Traffic zu 185.220.101.47 erkannt.');
    expect(ticket.analyst).toBe('j.mueller');
  });

  test('Roundtrip: toRow → fromRow erhält alle Felder', () => {
    const row = repo._toRow(FULL_TICKET);
    // JSONB als Objekt simulieren (wie PostgreSQL es zurückgibt)
    row.identity  = JSON.parse(row.identity);
    row.network   = JSON.parse(row.network);
    row.asset     = JSON.parse(row.asset);
    row.analysis  = JSON.parse(row.analysis);
    row.payloads  = JSON.parse(row.payloads);
    row.evidence  = JSON.parse(row.evidence);
    row.external_links = JSON.parse(row.external_links);
    row.created_at = { toISOString: () => FULL_TICKET.createdAt };
    row.updated_at = { toISOString: () => FULL_TICKET.updatedAt };
    row.occurred_at = { toISOString: () => FULL_TICKET.datetime };

    const roundtripped = repo._fromRow(row);

    // Alle flachen Felder
    for (const { domain } of FLAT_FIELDS) {
      expect(roundtripped[domain]).toBe(FULL_TICKET[domain]);
    }
    // Alle JSONB-Felder ('' Default; confidence ist Zahl/null)
    for (const fields of Object.values(JSONB_GROUPS)) {
      for (const f of fields) {
        if (f === 'confidence') { expect(roundtripped[f]).toBe(FULL_TICKET[f] ?? null); continue; }
        expect(roundtripped[f]).toBe(FULL_TICKET[f] || '');
      }
    }
  });

  test('analystState — _toRow() serialisiert das Feld als JSON-String', () => {
    const state = { checklist: [{ id: 'c1', label: 'IoCs', done: true }], playbook: { id: 'susp-ip', step: 1, status: 'in_progress' } };
    const ticket = Ticket.create({ title: 'Test', analystState: state });
    const row = repo._toRow(ticket);
    expect(typeof row.analyst_state).toBe('string');
    const parsed = JSON.parse(row.analyst_state);
    expect(parsed.checklist[0].done).toBe(true);
    expect(parsed.playbook.status).toBe('in_progress');
  });

  test('analystState — _fromRow() deserialisiert das Feld korrekt (JSONB als Objekt)', () => {
    const state = { checklist: [{ id: 'c1', label: 'IoCs', done: false }], playbook: {} };
    const ticket = Ticket.create({ title: 'Test', analystState: state });
    const row = repo._toRow(ticket);
    // Postgres gibt JSONB als Objekt zurück — simulieren:
    row.identity  = JSON.parse(row.identity);
    row.network   = JSON.parse(row.network);
    row.asset     = JSON.parse(row.asset);
    row.analysis  = JSON.parse(row.analysis);
    row.payloads  = JSON.parse(row.payloads);
    row.evidence  = JSON.parse(row.evidence);
    row.external_links = JSON.parse(row.external_links);
    row.analyst_state  = JSON.parse(row.analyst_state); // JSONB als Objekt
    row.created_at = { toISOString: () => ticket.createdAt };
    row.updated_at = { toISOString: () => ticket.updatedAt };
    row.occurred_at = null;

    const roundtripped = repo._fromRow(row);
    expect(roundtripped).toBeInstanceOf(Ticket);
    expect(roundtripped.analystState).toEqual(state);
  });

  test('analystState — Default {} wenn DB-Spalte fehlt / null', () => {
    const ticket = Ticket.create({ title: 'Test' });
    const row = repo._toRow(ticket);
    row.identity  = JSON.parse(row.identity);
    row.network   = JSON.parse(row.network);
    row.asset     = JSON.parse(row.asset);
    row.analysis  = JSON.parse(row.analysis);
    row.payloads  = JSON.parse(row.payloads);
    row.evidence  = JSON.parse(row.evidence);
    row.external_links = JSON.parse(row.external_links);
    row.analyst_state  = null; // fehlt in alter DB-Row
    row.created_at = { toISOString: () => ticket.createdAt };
    row.updated_at = { toISOString: () => ticket.updatedAt };
    row.occurred_at = null;

    const result = repo._fromRow(row);
    expect(result.analystState).toEqual({});
  });

  test('analystState — Roundtrip: toRow → fromRow erhält Checkliste + Playbook', () => {
    const state = {
      checklist: [
        { id: 'c1', label: 'IoCs prüfen', done: true },
        { id: 'c2', label: 'VT prüfen', done: false },
      ],
      playbook: { id: 'malware', step: 2, status: 'done' },
    };
    const ticket = Ticket.create({ title: 'Test', analystState: state });
    const row = repo._toRow(ticket);
    row.identity  = JSON.parse(row.identity);
    row.network   = JSON.parse(row.network);
    row.asset     = JSON.parse(row.asset);
    row.analysis  = JSON.parse(row.analysis);
    row.payloads  = JSON.parse(row.payloads);
    row.evidence  = JSON.parse(row.evidence);
    row.external_links = JSON.parse(row.external_links);
    row.analyst_state  = JSON.parse(row.analyst_state);
    row.created_at = { toISOString: () => ticket.createdAt };
    row.updated_at = { toISOString: () => ticket.updatedAt };
    row.occurred_at = null;

    const result = repo._fromRow(row);
    expect(result.analystState.checklist).toHaveLength(2);
    expect(result.analystState.checklist[0].done).toBe(true);
    expect(result.analystState.checklist[1].done).toBe(false);
    expect(result.analystState.playbook.status).toBe('done');
  });

  test('closed_at — _toRow() reicht closedAt eines CLOSED-Tickets durch (Audit #1)', () => {
    // FULL_TICKET ist CLOSED via create() → closedAt gesetzt
    const row = repo._toRow(FULL_TICKET);
    expect(row.closed_at).toBe(FULL_TICKET.closedAt);
    expect(row.closed_at).not.toBeNull();
  });

  test('closed_at — _toRow() setzt NULL für offenes Ticket', () => {
    const open = Ticket.create({ title: 'Offen', state: 'OPEN' });
    const row = repo._toRow(open);
    expect(row.closed_at).toBeNull();
  });

  test('closed_at — _fromRow() rekonstruiert closedAt aus DB (ISO)', () => {
    const iso = '2026-06-03T15:00:00.000Z';
    const row = repo._toRow(FULL_TICKET);
    row.identity = JSON.parse(row.identity); row.network = JSON.parse(row.network);
    row.asset = JSON.parse(row.asset); row.analysis = JSON.parse(row.analysis);
    row.payloads = JSON.parse(row.payloads); row.evidence = JSON.parse(row.evidence);
    row.external_links = JSON.parse(row.external_links);
    row.created_at = { toISOString: () => FULL_TICKET.createdAt };
    row.updated_at = { toISOString: () => FULL_TICKET.updatedAt };
    row.occurred_at = null;
    row.closed_at = { toISOString: () => iso }; // DB liefert Date-Objekt

    const result = repo._fromRow(row);
    expect(result.closedAt).toBe(iso);
  });

  test('closed_at — _fromRow() liefert null wenn DB-Spalte NULL (Altbestand)', () => {
    const row = repo._toRow(FULL_TICKET);
    row.identity = JSON.parse(row.identity); row.network = JSON.parse(row.network);
    row.asset = JSON.parse(row.asset); row.analysis = JSON.parse(row.analysis);
    row.payloads = JSON.parse(row.payloads); row.evidence = JSON.parse(row.evidence);
    row.external_links = JSON.parse(row.external_links);
    row.created_at = { toISOString: () => FULL_TICKET.createdAt };
    row.updated_at = { toISOString: () => FULL_TICKET.updatedAt };
    row.occurred_at = null;
    row.closed_at = null; // nicht-backfillter Altbestand

    const result = repo._fromRow(row);
    expect(result.closedAt).toBeNull();
  });

  test('Neues optionales Feld in JSONB_GROUPS: nur 1 Stelle ändern nötig', () => {
    // Simuliert: "testField" wurde zu JSONB_GROUPS.asset hinzugefügt
    // Das Ticket hätte dieses Feld
    const ticket = Ticket.create({ title: 'Test', os: 'Windows' });
    const row = repo._toRow(ticket);
    const asset = JSON.parse(row.asset);
    // os ist bereits in asset — korrekt gemappt ohne Code-Duplikat
    expect(asset.os).toBe('Windows');
    expect(Object.keys(asset)).toEqual(
      expect.arrayContaining(['os','assetTag','criticality','process','hash','mitre'])
    );
  });
});
