'use strict';

const { OTRSAdapter, OTRS_PRIORITY, OTRS_STATE } = require('../../src/integrations/adapters/otrs/OTRSAdapter');
const { ExternalTicketService, AUDIT_ACTIONS }   = require('../../src/integrations/ExternalTicketService');
const { InMemoryHttpClient }                     = require('../../src/integrations/http/InMemoryHttpClient');
const { Ticket }                                 = require('../../src/domain/Ticket');
const { auditService }                           = require('../../src/services/AuditService');

// OTRS Generic Interface Erfolgs-Response
const OTRS_SUCCESS = {
  TicketID:     '12345',
  TicketNumber: 'SOC-2026-00042',
};

// OTRS Fehler-Response (im Body, nicht als HTTP-Status!)
const OTRS_ERROR = {
  Error: {
    ErrorCode:    'TicketCreate.AuthFail',
    ErrorMessage: 'Authentication failed!',
  },
};

const TICKET = new Ticket({
  id:       'ticket-uuid-otrs',
  ticketNr: 'INC-2026-00842',
  title:    'Lateral Movement erkannt — PsExec',
  priority: 'high',
  status:   'open',
  analyst:  'k.weber',
  srcIp:    '192.168.241.55',
  dstIp:    '10.0.0.100',
  hostname: 'SRV-DC-01',
  mitre:    'T1021.002',
  description: 'PsExec von Workstation zu DC erkannt.',
  iocs:     'PSEXESVC service auf SRV-DC-01',
});

beforeEach(() => auditService.clearLog());

// ── OTRS Adapter Mapping ────────────────────────────────────

describe('OTRSAdapter.mapToExternal()', () => {
  const adapter = new OTRSAdapter({ queue: 'Security::SOC', username: 'testuser', password: 'testpass' });

  test('Ticket.Title wird gesetzt', () => {
    const p = adapter.mapToExternal(TICKET);
    expect(p.Ticket.Title).toBe('Lateral Movement erkannt — PsExec');
  });

  test('Queue wird gesetzt', () => {
    const p = adapter.mapToExternal(TICKET);
    expect(p.Ticket.Queue).toBe('Security::SOC');
  });

  test('OTRS_PRIORITY mapping: high → 4 high', () => {
    const p = adapter.mapToExternal(TICKET);
    expect(p.Ticket.Priority).toBe('4 high');
  });

  test('OTRS_STATE mapping: open → new', () => {
    const p = adapter.mapToExternal(TICKET);
    expect(p.Ticket.State).toBe('new');
  });

  test('Credentials sind im Body (OTRS-spezifisch)', () => {
    const p = adapter.mapToExternal(TICKET);
    expect(p.UserLogin).toBe('testuser');
    expect(p.Password).toBe('testpass');
  });

  test('Article enthält Beschreibung', () => {
    const p = adapter.mapToExternal(TICKET);
    expect(p.Article).toBeDefined();
    expect(p.Article.Body).toContain('PsExec von Workstation');
    expect(p.Article.Body).toContain('T1021.002');
    expect(p.Article.Subject).toBe('Lateral Movement erkannt — PsExec');
  });

  test('DynamicField enthält SOC-Felder', () => {
    const p = adapter.mapToExternal(TICKET);
    const names = p.DynamicField.map(f => f.Name);
    expect(names).toContain('SOCInternalId');
    expect(names).toContain('SOCMitre');
    const mitre = p.DynamicField.find(f => f.Name === 'SOCMitre');
    expect(mitre.Value).toBe('T1021.002');
  });

  test('OTRS_PRIORITY alle Werte', () => {
    expect(OTRS_PRIORITY.critical).toBe('5 very high');
    expect(OTRS_PRIORITY.high).toBe('4 high');
    expect(OTRS_PRIORITY.medium).toBe('3 normal');
    expect(OTRS_PRIORITY.low).toBe('2 low');
    expect(OTRS_PRIORITY.info).toBe('1 very low');
  });

  test('OTRS_STATE alle Werte', () => {
    expect(OTRS_STATE.open).toBe('new');
    expect(OTRS_STATE.progress).toBe('open');
    expect(OTRS_STATE.closed).toBe('closed successful');
    expect(OTRS_STATE.fp).toBe('closed unsuccessful');
  });
});

// ── OTRSAdapter.sendTicket() ────────────────────────────────

describe('OTRSAdapter.sendTicket()', () => {
  function makeAdapter(responses = []) {
    const http = new InMemoryHttpClient();
    responses.forEach(([status, data]) => http.queueResponse(status, data));
    return {
      adapter: new OTRSAdapter({
        baseUrl:    'https://otrs.test',
        username:   'soc_api',
        password:   'secret123',
        queue:      'Security',
        webService: 'GenericTicketConnectorREST',
        operation:  'TicketCreate',
        httpClient: http,
      }),
      http,
    };
  }

  test('sendet POST an Generic Interface und gibt externalId zurück', async () => {
    const { adapter, http } = makeAdapter([[200, OTRS_SUCCESS]]);
    const result = await adapter.sendTicket(TICKET);

    expect(result.externalId).toBe('12345');
    expect(result.externalRef).toBe('SOC-2026-00042');
    expect(result.externalUrl).toContain('TicketID=12345');

    const req = http.getLastRequest();
    expect(req.url).toContain('nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/TicketCreate');
    expect(req.method).toBe('POST');
  });

  test('URL-Aufbau korrekt: baseUrl/nph.../Webservice/{ws}/{op}', async () => {
    const { adapter } = makeAdapter([[200, OTRS_SUCCESS]]);
    expect(adapter.operationUrl).toBe(
      'https://otrs.test/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/TicketCreate'
    );
  });

  test('Credentials sind im Body — kein Auth-Header', async () => {
    const { adapter, http } = makeAdapter([[200, OTRS_SUCCESS]]);
    await adapter.sendTicket(TICKET);

    const req  = http.getLastRequest();
    expect(req.headers?.Authorization).toBeUndefined(); // kein HTTP Basic!
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    expect(body.UserLogin).toBe('soc_api');
    expect(body.Password).toBe('secret123');
  });

  test('OTRS Fehler im Body → expliziter Fehler', async () => {
    const { adapter } = makeAdapter([[200, OTRS_ERROR]]);
    await expect(adapter.sendTicket(TICKET))
      .rejects.toThrow('OTRS Fehler TicketCreate.AuthFail');
  });

  test('HTTP 500 → klarer Fehler', async () => {
    const { adapter } = makeAdapter([[500, { error: 'Server Error' }]]);
    await expect(adapter.sendTicket(TICKET)).rejects.toThrow('HTTP 500');
  });

  test('fehlende baseUrl → klarer Fehler', async () => {
    const a = new OTRSAdapter({ username: 'u', password: 'p' });
    await expect(a.sendTicket(TICKET)).rejects.toThrow('OTRS_BASE_URL');
  });

  test('fehlende Credentials → klarer Fehler', async () => {
    const a = new OTRSAdapter({ baseUrl: 'https://otrs.test' });
    await expect(a.sendTicket(TICKET)).rejects.toThrow('Credentials');
  });

  test('Antwort ohne TicketID → Fehler', async () => {
    const { adapter } = makeAdapter([[200, { TicketNumber: 'SOC-001' }]]);
    await expect(adapter.sendTicket(TICKET)).rejects.toThrow('TicketID');
  });

  test('TicketNumber = Fallback auf TicketID wenn nicht vorhanden', async () => {
    const { adapter } = makeAdapter([[200, { TicketID: '99' }]]);
    const result = await adapter.sendTicket(TICKET);
    expect(result.externalId).toBe('99');
    expect(result.externalRef).toBe('99'); // Fallback
  });
});

// ── ExternalTicketService mit OTRS ─────────────────────────

describe('ExternalTicketService.exportTicket() — OTRS', () => {
  function makeService() {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, OTRS_SUCCESS);
    const adapter = new OTRSAdapter({
      baseUrl: 'https://otrs.test', username: 'u', password: 'p', httpClient: http,
    });
    return { service: new ExternalTicketService({ otrs: adapter }), http };
  }

  test('Erfolg → ExternalLink mit provider=otrs', async () => {
    const { service } = makeService();
    const result = await service.exportTicket(TICKET, 'otrs');

    expect(result.status).toBe('exported');
    expect(result.externalId).toBe('12345');
    expect(result.link.externalSystem).toBe('otrs');
    expect(result.link.syncStatus).toBe('synced');
  });

  test('Erfolg → EXPORT_SUCCESS Audit-Event', async () => {
    const { service } = makeService();
    await service.exportTicket(TICKET, 'otrs');

    const log = auditService.getLog();
    const ev  = log.find(e => e.action === AUDIT_ACTIONS.EXPORT_SUCCESS);
    expect(ev).toBeDefined();
    expect(ev.metadata.system).toBe('otrs');
    expect(ev.metadata.externalRef).toBe('SOC-2026-00042');
  });

  test('OTRS Fehler im Body → EXPORT_FAILED Audit-Event', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, OTRS_ERROR); // HTTP 200, aber Error im Body!
    const adapter = new OTRSAdapter({ baseUrl: 'https://otrs.test', username: 'u', password: 'p', httpClient: http });
    const service = new ExternalTicketService({ otrs: adapter });

    await expect(service.exportTicket(TICKET, 'otrs')).rejects.toThrow('AuthFail');
    expect(auditService.getLog().some(e => e.action === AUDIT_ACTIONS.EXPORT_FAILED)).toBe(true);
  });
});

// ── Beide Adapter parallel registriert ─────────────────────

describe('ExternalTicketService — ServiceNow + OTRS parallel', () => {
  test('registeredSystems() enthält beide', () => {
    const { ServiceNowAdapter } = require('../../src/integrations/adapters/servicenow/ServiceNowAdapter');
    const service = new ExternalTicketService({
      servicenow: new ServiceNowAdapter(),
      otrs:       new OTRSAdapter(),
    });
    expect(service.registeredSystems()).toContain('servicenow');
    expect(service.registeredSystems()).toContain('otrs');
  });

  test('prepareExport: ServiceNow und OTRS unterschiedliche Payloads', () => {
    const { ServiceNowAdapter } = require('../../src/integrations/adapters/servicenow/ServiceNowAdapter');
    const service = new ExternalTicketService({
      servicenow: new ServiceNowAdapter({ username: 'u', password: 'p' }),
      otrs:       new OTRSAdapter({ username: 'u', password: 'p' }),
    });

    const snResult   = service.prepareExport(TICKET, 'servicenow');
    const otrsResult = service.prepareExport(TICKET, 'otrs');

    // ServiceNow: flaches Payload
    expect(snResult.payload.short_description).toBeDefined();
    expect(snResult.payload.Ticket).toBeUndefined();

    // OTRS: verschachteltes Payload
    expect(otrsResult.payload.Ticket).toBeDefined();
    expect(otrsResult.payload.short_description).toBeUndefined();
    expect(otrsResult.payload.UserLogin).toBe('u'); // Credentials im Body!
  });
});
