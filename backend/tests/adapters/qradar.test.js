'use strict';

const { QRadarAdapter }    = require('../../src/integrations/adapters/qradar/QRadarAdapter');
const { QRadarProcessor }  = require('../../src/integrations/adapters/qradar/QRadarProcessor');
const { mapSeverityToPriority, mapStatus, extractTitle, extractIPs, mapOffenseToNormalized }
                            = require('../../src/integrations/adapters/qradar/qradarMapper');
const { ticketService }    = require('../../src/services/TicketService');
const { auditService }     = require('../../src/services/AuditService');

const adapter = new QRadarAdapter();

// Minimales gültiges QRadar Offense-Payload
const VALID_OFFENSE = {
  id:          9134,
  description: 'Multiple Failed SSH Logins from External IP',
  severity:    8,
  credibility: 7,
  relevance:   9,
  status:      'OPEN',
  start_time:  1748952000000,
  categories:  ['Authentication.LoginFailed', 'Reconnaissance.NetworkScan'],
  source_ips:  ['185.220.101.47'],
  dest_ips:    ['192.168.243.45'],
};

beforeEach(() => {
  ticketService._repo.clear();
  auditService.clearLog();
});

// ── P10.1: QRadarAdapter implementiert BaseAdapter ────────

describe('QRadarAdapter — implements BaseAdapter', () => {
  test('source ist "qradar"', () => {
    expect(adapter.source).toBe('qradar');
  });

  test('hat validate(), normalize(), toTicketDraft()', () => {
    expect(typeof adapter.validate).toBe('function');
    expect(typeof adapter.normalize).toBe('function');
    expect(typeof adapter.toTicketDraft).toBe('function');
  });
});

// ── P10.1: Validierung ─────────────────────────────────────

describe('QRadarAdapter.validate()', () => {
  test('valides Offense-Payload wird akzeptiert', () => {
    expect(() => adapter.validate(VALID_OFFENSE)).not.toThrow();
  });

  test('fehlendes id → ValidationError', () => {
    const { ValidationError } = require('../../src/errors/AppError');
    expect(() => adapter.validate({ description: 'Test' })).toThrow(ValidationError);
  });

  test('null/kein Objekt → ValidationError', () => {
    const { ValidationError } = require('../../src/errors/AppError');
    expect(() => adapter.validate(null)).toThrow(ValidationError);
    expect(() => adapter.validate('string')).toThrow(ValidationError);
  });

  test('unbekannte Felder werden toleriert (QRadar kann mehr senden)', () => {
    const extended = { ...VALID_OFFENSE, custom_field: 'value', domain_id: 5 };
    expect(() => adapter.validate(extended)).not.toThrow();
  });

  test('fehlende optionale Felder werden akzeptiert', () => {
    expect(() => adapter.validate({ id: 1 })).not.toThrow();
  });
});

// ── P10.2: Mapper — Priority-Berechnung ───────────────────

describe('mapSeverityToPriority()', () => {
  test('severity=10, cred=10, rel=10 → critical', () => {
    expect(mapSeverityToPriority(10, 10, 10)).toBe('critical');
  });

  test('severity=8, cred=7, rel=9 → high oder critical', () => {
    const p = mapSeverityToPriority(8, 7, 9);
    expect(['high', 'critical']).toContain(p);
  });

  test('severity=5, cred=5, rel=5 → medium', () => {
    expect(mapSeverityToPriority(5, 5, 5)).toBe('medium');
  });

  test('severity=3, cred=3, rel=3 → low', () => {
    expect(mapSeverityToPriority(3, 3, 3)).toBe('low');
  });

  test('severity=1, cred=1, rel=1 → info', () => {
    expect(mapSeverityToPriority(1, 1, 1)).toBe('info');
  });

  test('fehlende credibility/relevance → fällt auf Default (5)', () => {
    const p = mapSeverityToPriority(8, null, null);
    expect(['high', 'critical', 'medium']).toContain(p);
  });
});

describe('mapStatus()', () => {
  test('OPEN → open', ()   => expect(mapStatus('OPEN')).toBe('open'));
  test('CLOSED → closed', () => expect(mapStatus('CLOSED')).toBe('closed'));
  test('HIDDEN → fp', ()  => expect(mapStatus('HIDDEN')).toBe('fp'));
  test('unbekannt → open', () => expect(mapStatus('UNKNOWN')).toBe('open'));
});

describe('extractTitle()', () => {
  test('nutzt description wenn vorhanden', () => {
    expect(extractTitle({ id: 1, description: 'SSH Brute Force' })).toBe('SSH Brute Force');
  });
  test('nutzt offense_name als Fallback', () => {
    expect(extractTitle({ id: 1, offense_name: 'Login Failure' })).toBe('Login Failure');
  });
  test('Default-Titel wenn beides fehlt', () => {
    expect(extractTitle({ id: 42 })).toContain('42');
  });
  test('schneidet auf 200 Zeichen ab', () => {
    expect(extractTitle({ id: 1, description: 'A'.repeat(300) }).length).toBe(200);
  });
});

describe('extractIPs()', () => {
  test('extrahiert Source und Dest IPs', () => {
    const ips = extractIPs({ source_ips: ['1.2.3.4', '5.6.7.8'], dest_ips: ['10.0.0.1'] });
    expect(ips.srcIp).toBe('1.2.3.4');
    expect(ips.dstIp).toBe('10.0.0.1');
    expect(ips.allSrcIps.length).toBe(2);
  });
  test('leere Arrays wenn keine IPs', () => {
    const ips = extractIPs({});
    expect(ips.srcIp).toBe('');
    expect(ips.dstIp).toBe('');
  });
});

// ── P10.2: normalize() ────────────────────────────────────

describe('QRadarAdapter.normalize()', () => {
  test('gibt source=qradar zurück', () => {
    const r = adapter.normalize(VALID_OFFENSE);
    expect(r.source).toBe('qradar');
  });

  test('externalId = qradar:offense:<id>', () => {
    const r = adapter.normalize(VALID_OFFENSE);
    expect(r.externalId).toBe('qradar:offense:9134');
  });

  test('title wird aus description extrahiert', () => {
    const r = adapter.normalize(VALID_OFFENSE);
    expect(r.title).toContain('Failed SSH Logins');
  });

  test('priority wird aus severity/credibility/relevance berechnet', () => {
    const r = adapter.normalize(VALID_OFFENSE);
    expect(['critical', 'high']).toContain(r.priority);
  });

  test('srcIp und dstIp werden gesetzt', () => {
    const r = adapter.normalize(VALID_OFFENSE);
    expect(r.srcIp).toBe('185.220.101.47');
    expect(r.dstIp).toBe('192.168.243.45');
  });

  test('Raw Payload bleibt als Evidence erhalten (Traceability)', () => {
    const r = adapter.normalize(VALID_OFFENSE);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.evidence[0].type).toBe('qradar_offense');
    expect(r.evidence[0].raw).toEqual(VALID_OFFENSE);
  });

  test('fehlende optionale Felder → keine Fehler', () => {
    expect(() => adapter.normalize({ id: 1 })).not.toThrow();
  });

  test('Zeitstempel wird aus start_time konvertiert (ISO 8601)', () => {
    const r = adapter.normalize(VALID_OFFENSE);
    expect(r.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 Format
  });
});

// ── P10.2: toTicketDraft() ────────────────────────────────

describe('QRadarAdapter.toTicketDraft()', () => {
  test('Draft enthält alle Ticket-Felder', () => {
    const normalized = adapter.normalize(VALID_OFFENSE);
    const draft      = adapter.toTicketDraft(normalized);
    expect(draft.title).toBeDefined();
    expect(draft.priority).toBeDefined();
    expect(draft.source).toBe('qradar');
    expect(draft.offenseId).toBe('qradar:offense:9134');
  });
});

// ── P10.3: QRadarProcessor — idempotentes Ticket Create/Update ─

describe('QRadarProcessor.process()', () => {
  test('erstes Event → Ticket wird erstellt', async () => {
    const processor  = new QRadarProcessor();
    const normalized = adapter.normalize(VALID_OFFENSE);
    const result     = await processor.process(normalized);

    expect(result.action).toBe('created');
    expect(result.ticketId).toBeDefined();

    const tickets = (await ticketService.findAll()).data;
    expect(tickets.length).toBe(1);
    expect(tickets[0].title).toContain('Failed SSH Logins');
  });

  test('gleiches Event zweimal → kein zweites Ticket (idempotent)', async () => {
    const processor  = new QRadarProcessor();
    const normalized = adapter.normalize(VALID_OFFENSE);

    const r1 = await processor.process(normalized);
    const r2 = await processor.process(normalized);

    expect(r1.action).toBe('created');
    expect(r2.action).toBe('updated');
    expect(r2.ticketId).toBe(r1.ticketId);

    const tickets = (await ticketService.findAll()).data;
    expect(tickets.length).toBe(1); // Nur ein Ticket!
  });

  test('Update ändert Priority wenn QRadar Severity sich ändert', async () => {
    const processor = new QRadarProcessor();
    const norm1     = adapter.normalize({ ...VALID_OFFENSE, severity: 3 });
    const r1        = await processor.process(norm1);

    const norm2 = adapter.normalize({ ...VALID_OFFENSE, severity: 9 });
    await processor.process(norm2);

    const ticket = await ticketService.findById(r1.ticketId);
    expect(ticket.priority).toBe('critical');
  });

  test('Audit-Event QRADAR_TICKET_CREATED wird geschrieben', async () => {
    const processor  = new QRadarProcessor();
    const normalized = adapter.normalize(VALID_OFFENSE);
    await processor.process(normalized);
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'QRADAR_TICKET_CREATED')).toBe(true);
  });

  test('Audit-Event QRADAR_TICKET_UPDATED wird beim zweiten Event geschrieben', async () => {
    const processor  = new QRadarProcessor();
    const normalized = adapter.normalize(VALID_OFFENSE);
    await processor.process(normalized);
    await processor.process(normalized);
    const log = auditService.getLog();
    expect(log.some(e => e.action === 'QRADAR_TICKET_UPDATED')).toBe(true);
  });
});

// ── P10: IntegrationService nutzt QRadarAdapter ────────────

describe('IntegrationService — QRadar source nutzt QRadarAdapter', () => {
  test('qradar source hat QRadarAdapter', () => {
    const { integrationService } = require('../../src/integrations/IntegrationService');
    const adapter = integrationService.getAdapter('qradar');
    expect(adapter.constructor.name).toBe('QRadarAdapter');
  });
});
