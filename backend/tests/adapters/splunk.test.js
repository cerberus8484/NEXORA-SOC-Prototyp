'use strict';

const { SplunkAdapter }    = require('../../src/integrations/adapters/splunk/SplunkAdapter');
const { SplunkProcessor }  = require('../../src/integrations/adapters/splunk/SplunkProcessor');
const { mapUrgencyToPriority, mapTimestamp, coalesce, extractTitle,
        extractSrcIp, extractDstIp, extractUser }
                            = require('../../src/integrations/adapters/splunk/splunkMapper');
const { ticketService }    = require('../../src/services/TicketService');
const { auditService }     = require('../../src/services/AuditService');

const adapter = new SplunkAdapter();

// Minimales gültiges Splunk Alert-Payload (Splunk ES Notable Event Format)
const VALID_ALERT = {
  sid:         '1748952000.12345',
  search_name: 'PowerShell C2 Beacon Detection',
  result: {
    event_id:            'c35a4b2d-88f1-4e3a-9b12-0a5e7f8d2c91@@notable@@1748952000',
    rule_name:           'PowerShell C2 Beacon Detection',
    rule_title:          'Suspicious PowerShell Outbound Traffic',
    urgency:             'high',
    _time:               1748952000,
    src:                 '192.168.243.45',
    src_dns:             'PC-FIN-045.corp.local',
    dest:                '185.220.101.47',
    dest_dns:            'cdn-update.fastnetwork.ru',
    dest_port:           443,
    user:                'CORP\\jdoe',
    protocol:            'tcp',
    category:            'C2 Communication',
    'mitre_technique_id':   'T1059.001',
    'mitre_technique_name': 'PowerShell',
    description:         'Outbound HTTPS connection to known C2 IP',
  },
};

beforeEach(() => {
  ticketService._repo.clear();
  auditService.clearLog();
});

// ── P11.1: SplunkAdapter implementiert BaseAdapter ────────

describe('SplunkAdapter — implements BaseAdapter', () => {
  test('source ist "splunk"', () => {
    expect(adapter.source).toBe('splunk');
  });

  test('hat validate(), normalize(), toTicketDraft()', () => {
    expect(typeof adapter.validate).toBe('function');
    expect(typeof adapter.normalize).toBe('function');
    expect(typeof adapter.toTicketDraft).toBe('function');
  });
});

// ── P11.1: Validierung ─────────────────────────────────────

describe('SplunkAdapter.validate()', () => {
  test('valides Alert-Payload wird akzeptiert', () => {
    expect(() => adapter.validate(VALID_ALERT)).not.toThrow();
  });

  test('Payload ohne Identifikation → ValidationError', () => {
    const { ValidationError } = require('../../src/errors/AppError');
    expect(() => adapter.validate({ result: {} })).toThrow(ValidationError);
  });

  test('null → ValidationError', () => {
    const { ValidationError } = require('../../src/errors/AppError');
    expect(() => adapter.validate(null)).toThrow(ValidationError);
    expect(() => adapter.validate('string')).toThrow(ValidationError);
  });

  test('nur search_name reicht als Identifikation', () => {
    expect(() => adapter.validate({ search_name: 'My Alert', result: {} })).not.toThrow();
  });

  test('nur result.rule_name reicht', () => {
    expect(() => adapter.validate({ result: { rule_name: 'Test' } })).not.toThrow();
  });

  test('unbekannte Felder werden toleriert (Splunk kann beliebige Felder senden)', () => {
    const extended = { ...VALID_ALERT, custom_field: 'value', extra: 123 };
    expect(() => adapter.validate(extended)).not.toThrow();
  });
});

// ── P11.2: Mapper ──────────────────────────────────────────

describe('mapUrgencyToPriority()', () => {
  test('critical → critical', () => expect(mapUrgencyToPriority('critical')).toBe('critical'));
  test('high → high',         () => expect(mapUrgencyToPriority('high')).toBe('high'));
  test('medium → medium',     () => expect(mapUrgencyToPriority('medium')).toBe('medium'));
  test('low → low',           () => expect(mapUrgencyToPriority('low')).toBe('low'));
  test('informational → info',() => expect(mapUrgencyToPriority('informational')).toBe('info'));
  test('unbekannt → medium',  () => expect(mapUrgencyToPriority('unknown')).toBe('medium'));
  test('leer → medium',       () => expect(mapUrgencyToPriority('')).toBe('medium'));
});

describe('mapTimestamp()', () => {
  test('Unix Sekunden → ISO 8601', () => {
    const iso = mapTimestamp(1748952000);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  test('null → leer', () => expect(mapTimestamp(null)).toBe(''));
  test('0 → leer',    () => expect(mapTimestamp(0)).toBe(''));
});

describe('coalesce()', () => {
  test('gibt erstes nicht-leeres zurück', () => {
    expect(coalesce('', null, 'gefunden', 'anderes')).toBe('gefunden');
  });
  test('gibt leer wenn alle leer', () => {
    expect(coalesce('', null, undefined)).toBe('');
  });
});

describe('extractTitle()', () => {
  test('nutzt rule_title wenn vorhanden', () => {
    expect(extractTitle(VALID_ALERT)).toBe('Suspicious PowerShell Outbound Traffic');
  });
  test('fällt auf rule_name zurück', () => {
    const p = { result: { rule_name: 'Fallback Rule' } };
    expect(extractTitle(p)).toBe('Fallback Rule');
  });
  test('fällt auf search_name zurück', () => {
    const p = { search_name: 'My Search', result: {} };
    expect(extractTitle(p)).toBe('My Search');
  });
  test('Default wenn alles leer', () => {
    const p = { sid: 'abc123', result: {} };
    expect(extractTitle(p)).toContain('abc123');
  });
  test('schneidet auf 200 Zeichen ab', () => {
    const p = { result: { rule_title: 'A'.repeat(300) } };
    expect(extractTitle(p).length).toBe(200);
  });
});

describe('extractSrcIp / extractDstIp / extractUser()', () => {
  test('src bevorzugt gegenüber src_ip', () => {
    expect(extractSrcIp({ src: '1.2.3.4', src_ip: '5.6.7.8' })).toBe('1.2.3.4');
  });
  test('src_ip als Fallback', () => {
    expect(extractSrcIp({ src_ip: '5.6.7.8' })).toBe('5.6.7.8');
  });
  test('dest bevorzugt', () => {
    expect(extractDstIp({ dest: '10.0.0.1', dest_ip: '10.0.0.2' })).toBe('10.0.0.1');
  });
  test('user bevorzugt gegenüber src_user', () => {
    expect(extractUser({ user: 'jdoe', src_user: 'svc_acct' })).toBe('jdoe');
  });
});

// ── P11.2: normalize() ────────────────────────────────────

describe('SplunkAdapter.normalize()', () => {
  test('source = splunk', () => {
    expect(adapter.normalize(VALID_ALERT).source).toBe('splunk');
  });

  test('externalId = splunk:alert:<event_id>', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.externalId).toContain('splunk:alert:');
    expect(r.externalId).toContain(VALID_ALERT.result.event_id.substring(0, 10));
  });

  test('title aus rule_title', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.title).toBe('Suspicious PowerShell Outbound Traffic');
  });

  test('priority aus urgency=high', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.priority).toBe('high');
  });

  test('srcIp und dstIp werden gesetzt', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.srcIp).toBe('192.168.243.45');
    expect(r.dstIp).toBe('185.220.101.47');
  });

  test('srcFqdn und dstFqdn werden gesetzt', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.srcFqdn).toBe('PC-FIN-045.corp.local');
    expect(r.dstFqdn).toBe('cdn-update.fastnetwork.ru');
  });

  test('user wird extrahiert', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.user).toBe('CORP\\jdoe');
  });

  test('mitre wird extrahiert', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.mitre).toBe('T1059.001');
  });

  test('Raw Payload bleibt als Evidence (Traceability)', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.evidence[0].type).toBe('splunk_alert');
    expect(r.evidence[0].raw).toEqual(VALID_ALERT);
  });

  test('Zeitstempel wird konvertiert (ISO 8601)', () => {
    const r = adapter.normalize(VALID_ALERT);
    expect(r.datetime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('fehlende optionale Felder → keine Fehler', () => {
    expect(() => adapter.normalize({ search_name: 'Min Alert', result: {} })).not.toThrow();
  });

  test('koaleszierende IP-Felder: src_ip als Fallback', () => {
    const p = { ...VALID_ALERT, result: { ...VALID_ALERT.result, src: '', src_ip: '9.9.9.9' } };
    const r = adapter.normalize(p);
    expect(r.srcIp).toBe('9.9.9.9');
  });
});

// ── P11.2: toTicketDraft() ────────────────────────────────

describe('SplunkAdapter.toTicketDraft()', () => {
  test('Draft enthält alle Ticket-Felder', () => {
    const normalized = adapter.normalize(VALID_ALERT);
    const draft      = adapter.toTicketDraft(normalized);
    expect(draft.title).toBeDefined();
    expect(draft.priority).toBeDefined();
    expect(draft.source).toBe('splunk');
    expect(draft.srcIp).toBe('192.168.243.45');
    expect(draft.mitre).toBe('T1059.001');
  });
});

// ── P11.3: SplunkProcessor — idempotentes Ticket Create/Update ─

describe('SplunkProcessor.process()', () => {
  test('erstes Event → Ticket wird erstellt', async () => {
    const processor  = new SplunkProcessor();
    const normalized = adapter.normalize(VALID_ALERT);
    const result     = await processor.process(normalized);

    expect(result.action).toBe('created');
    expect(result.ticketId).toBeDefined();

    const tickets = (await ticketService.findAll()).data;
    expect(tickets.length).toBe(1);
    expect(tickets[0].source).toBe('splunk');
  });

  test('gleiches Event zweimal → kein zweites Ticket (idempotent)', async () => {
    const processor  = new SplunkProcessor();
    const normalized = adapter.normalize(VALID_ALERT);

    const r1 = await processor.process(normalized);
    const r2 = await processor.process(normalized);

    expect(r1.action).toBe('created');
    expect(r2.action).toBe('updated');
    expect(r2.ticketId).toBe(r1.ticketId);

    const tickets = (await ticketService.findAll()).data;
    expect(tickets.length).toBe(1);
  });

  test('Update ändert Priority wenn Splunk urgency sich ändert', async () => {
    const processor = new SplunkProcessor();
    const low  = adapter.normalize({ ...VALID_ALERT, result: { ...VALID_ALERT.result, urgency: 'low'      } });
    const high = adapter.normalize({ ...VALID_ALERT, result: { ...VALID_ALERT.result, urgency: 'critical' } });

    const r1 = await processor.process(low);
    await processor.process(high);

    const ticket = await ticketService.findById(r1.ticketId);
    expect(ticket.priority).toBe('critical');
  });

  test('Audit-Event SPLUNK_TICKET_CREATED wird geschrieben', async () => {
    const processor  = new SplunkProcessor();
    await processor.process(adapter.normalize(VALID_ALERT));
    expect(auditService.getLog().some(e => e.action === 'SPLUNK_TICKET_CREATED')).toBe(true);
  });

  test('Audit-Event SPLUNK_TICKET_UPDATED beim zweiten Event', async () => {
    const processor  = new SplunkProcessor();
    const normalized = adapter.normalize(VALID_ALERT);
    await processor.process(normalized);
    await processor.process(normalized);
    expect(auditService.getLog().some(e => e.action === 'SPLUNK_TICKET_UPDATED')).toBe(true);
  });
});

// ── P11: IntegrationService nutzt SplunkAdapter ───────────

describe('IntegrationService — splunk source nutzt SplunkAdapter', () => {
  test('splunk source hat SplunkAdapter', () => {
    const { integrationService } = require('../../src/integrations/IntegrationService');
    const a = integrationService.getAdapter('splunk');
    expect(a.constructor.name).toBe('SplunkAdapter');
  });
});
