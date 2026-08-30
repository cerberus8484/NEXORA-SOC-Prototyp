'use strict';

const { ExternalTicketAdapter }  = require('../../src/integrations/ExternalTicketAdapter');
const { ServiceNowAdapter, SN_PRIORITY, SN_STATE } = require('../../src/integrations/adapters/servicenow/ServiceNowAdapter');
const { OTRSAdapter, OTRS_PRIORITY, OTRS_STATE }   = require('../../src/integrations/adapters/otrs/OTRSAdapter');
const { ExternalTicketService }  = require('../../src/integrations/ExternalTicketService');
const { mapBaseFields, mapPriorityLabel, mapStatusLabel } = require('../../src/integrations/externalTicketMapper');
const { Ticket }                 = require('../../src/domain/Ticket');
const { auditService }           = require('../../src/services/AuditService');

// Vollständiges Test-Ticket
const FULL_TICKET = new Ticket({
  id:          'test-uuid-001',
  ticketNr:    'INC-2026-00842',
  title:       'Suspicious PowerShell C2 Beacon',
  category:    'C2 Communication',
  priority:    'high',
  status:      'progress',
  analyst:     'j.mueller',
  source:      'qradar',
  datetime:    '2026-06-03T14:05:00.000Z',
  srcIp:       '192.168.243.45',
  srcFqdn:     'PC-FIN-045.corp.local',
  dstIp:       '185.220.101.47',
  dstFqdn:     'cdn-update.fastnetwork.ru',
  hostname:    'PC-FIN-045',
  mitre:       'T1059.001',
  description: 'Verdächtiger HTTPS-Traffic erkannt.',
  iocs:        '185.220.101.47\nsvcupdate.ps1',
  logs:        'QRadar OFF-009134',
  actions:     '14:12 Endpoint isoliert',
});

beforeEach(() => auditService.clearLog());

// ── ExternalTicketAdapter Interface ───────────────────────

describe('ExternalTicketAdapter Interface', () => {
  test('nicht implementierte Methoden werfen Fehler', () => {
    const a = new ExternalTicketAdapter('test');
    expect(() => a.mapToExternal({})).toThrow('nicht implementiert');
    expect(() => a.validateExternalPayload({})).toThrow('nicht implementiert');
    expect(a.sendTicket({})).rejects.toThrow('nicht implementiert');
  });

  test('system-Name ist gesetzt', () => {
    const a = new ExternalTicketAdapter('my-system');
    expect(a.system).toBe('my-system');
  });
});

// ── Basis-Mapper ───────────────────────────────────────────

describe('externalTicketMapper', () => {
  test('mapBaseFields() extrahiert alle Kern-Felder', () => {
    const base = mapBaseFields(FULL_TICKET);
    expect(base.title).toBe('Suspicious PowerShell C2 Beacon');
    expect(base.priority).toBe('High');
    expect(base.status).toBe('In Progress');
    expect(base.analyst).toBe('j.mueller');
    expect(base.sourceIp).toBe('192.168.243.45');
    expect(base.destIp).toBe('185.220.101.47');
    expect(base.mitre).toBe('T1059.001');
  });

  test('buildDescription enthält description + iocs + logs', () => {
    const base = mapBaseFields(FULL_TICKET);
    expect(base.description).toContain('Verdächtiger HTTPS-Traffic');
    expect(base.description).toContain('185.220.101.47');
    expect(base.description).toContain('QRadar OFF-009134');
  });

  test('mapPriorityLabel: alle Werte', () => {
    expect(mapPriorityLabel('critical')).toBe('Critical');
    expect(mapPriorityLabel('high')).toBe('High');
    expect(mapPriorityLabel('medium')).toBe('Medium');
    expect(mapPriorityLabel('low')).toBe('Low');
    expect(mapPriorityLabel('info')).toBe('Informational');
    expect(mapPriorityLabel('unknown')).toBe('Medium'); // Default
  });

  test('mapStatusLabel: alle Werte', () => {
    expect(mapStatusLabel('open')).toBe('New');
    expect(mapStatusLabel('progress')).toBe('In Progress');
    expect(mapStatusLabel('closed')).toBe('Resolved');
    expect(mapStatusLabel('fp')).toBe('Closed (False Positive)');
  });
});

// ── ServiceNow Adapter ─────────────────────────────────────

describe('ServiceNowAdapter', () => {
  const sn = new ServiceNowAdapter({ queue: 'Security' });

  test('system = servicenow', () => expect(sn.system).toBe('servicenow'));

  test('mapToExternal() erzeugt ServiceNow Table API Payload', () => {
    const p = sn.mapToExternal(FULL_TICKET);
    expect(p.short_description).toBe('Suspicious PowerShell C2 Beacon');
    expect(p.priority).toBe('2');           // high → '2'
    expect(p.state).toBe('2');              // progress → '2' (In Progress)
    expect(p.correlation_id).toContain('soc:');
    expect(p.category).toBe('security');
  });

  test('SN_PRIORITY mapping vollständig', () => {
    expect(SN_PRIORITY.critical).toBe('1');
    expect(SN_PRIORITY.high).toBe('2');
    expect(SN_PRIORITY.medium).toBe('3');
    expect(SN_PRIORITY.low).toBe('4');
  });

  test('SN_STATE mapping', () => {
    expect(SN_STATE.open).toBe('1');
    expect(SN_STATE.progress).toBe('2');
    expect(SN_STATE.closed).toBe('6');
    expect(SN_STATE.fp).toBe('7');
  });

  test('work_notes enthält MITRE und IPs', () => {
    const p = sn.mapToExternal(FULL_TICKET);
    expect(p.work_notes).toContain('T1059.001');
    expect(p.work_notes).toContain('192.168.243.45');
  });

  test('validateExternalPayload: leer → Fehler', () => {
    expect(() => sn.validateExternalPayload({ short_description: '' })).toThrow();
  });

  test('validateExternalPayload: gültig → kein Fehler', () => {
    const p = sn.mapToExternal(FULL_TICKET);
    expect(() => sn.validateExternalPayload(p)).not.toThrow();
  });

  test('short_description max 160 Zeichen', () => {
    const longTitle = new Ticket({ ...FULL_TICKET, title: 'A'.repeat(200) });
    const p = sn.mapToExternal(longTitle);
    expect(p.short_description.length).toBe(160);
  });

  test('sendTicket() wirft ohne Konfiguration (keine URL)', async () => {
    // ServiceNow ohne baseUrl → klarer Config-Fehler
    const unconfigured = new ServiceNowAdapter();
    await expect(unconfigured.sendTicket(FULL_TICKET)).rejects.toThrow('BASE_URL');
  });
});

// ── OTRS Adapter ───────────────────────────────────────────

describe('OTRSAdapter', () => {
  const otrs = new OTRSAdapter({ queue: 'Security::SOC' });

  test('system = otrs', () => expect(otrs.system).toBe('otrs'));

  test('mapToExternal() erzeugt OTRS Ticket-Payload (verschachtelt)', () => {
    const p = otrs.mapToExternal(FULL_TICKET);
    expect(p.Ticket.Title).toBe('Suspicious PowerShell C2 Beacon');
    expect(p.Ticket.Queue).toBe('Security::SOC');
    expect(p.Ticket.Priority).toBe('4 high');
    expect(p.Ticket.State).toBe('open');
    expect(p.Ticket.Type).toBe('Incident');
  });

  test('OTRS_PRIORITY mapping', () => {
    expect(OTRS_PRIORITY.critical).toBe('5 very high');
    expect(OTRS_PRIORITY.high).toBe('4 high');
    expect(OTRS_PRIORITY.medium).toBe('3 normal');
  });

  test('Article enthält Beschreibung', () => {
    const p = otrs.mapToExternal(FULL_TICKET);
    expect(p.Article).toBeDefined();
    expect(p.Article.Body).toContain('Verdächtiger HTTPS-Traffic');
    expect(p.Article.Subject).toBe('Suspicious PowerShell C2 Beacon');
  });

  test('DynamicField enthält SOC-Felder', () => {
    const p = otrs.mapToExternal(FULL_TICKET);
    const ids = p.DynamicField.map(f => f.Name);
    expect(ids).toContain('SOCInternalId');
    expect(ids).toContain('SOCMitre');
    const mitre = p.DynamicField.find(f => f.Name === 'SOCMitre');
    expect(mitre.Value).toBe('T1059.001');
  });

  test('validateExternalPayload: kein Title → Fehler', () => {
    expect(() => otrs.validateExternalPayload({ Ticket: { Title: '', Queue: 'SOC' }, UserLogin: 'u' })).toThrow();
  });

  test('validateExternalPayload: keine Queue → Fehler', () => {
    expect(() => otrs.validateExternalPayload({ Ticket: { Title: 'T', Queue: '' }, UserLogin: 'u' })).toThrow();
  });

  test('sendTicket() wirft ohne Konfiguration', async () => {
    const unconfigured = new OTRSAdapter();
    await expect(unconfigured.sendTicket(FULL_TICKET)).rejects.toThrow('OTRS_BASE_URL');
  });
});

// ── ExternalTicketService ──────────────────────────────────

describe('ExternalTicketService.prepareExport()', () => {
  const service = new ExternalTicketService({
    servicenow: new ServiceNowAdapter(),
    otrs:       new OTRSAdapter({ username: 'u', password: 'p' }),
  });

  test('ServiceNow Payload wird vorbereitet', () => {
    const { system, payload } = service.prepareExport(FULL_TICKET, 'servicenow');
    expect(system).toBe('servicenow');
    expect(payload.short_description).toBe('Suspicious PowerShell C2 Beacon');
    expect(payload.priority).toBe('2');
  });

  test('OTRS Payload wird vorbereitet (verschachteltes Format)', () => {
    const { system, payload } = service.prepareExport(FULL_TICKET, 'otrs');
    expect(system).toBe('otrs');
    expect(payload.Ticket.Title).toBe('Suspicious PowerShell C2 Beacon');
    expect(payload.Article).toBeDefined();
    expect(payload.UserLogin).toBeDefined(); // Credentials im Body
  });

  test('unbekanntes System → NotFoundError', () => {
    const { NotFoundError } = require('../../src/errors/AppError');
    expect(() => service.prepareExport(FULL_TICKET, 'unknown-system')).toThrow(NotFoundError);
  });

  test('registeredSystems() gibt bekannte Systeme zurück', () => {
    expect(service.registeredSystems()).toContain('servicenow');
    expect(service.registeredSystems()).toContain('otrs');
  });

  test('exportTicket() wirft ohne Config (keine ServiceNow URL)', async () => {
    const s = new ExternalTicketService({ servicenow: new ServiceNowAdapter() });
    await expect(s.exportTicket(FULL_TICKET, 'servicenow')).rejects.toThrow('BASE_URL');
  });
});
