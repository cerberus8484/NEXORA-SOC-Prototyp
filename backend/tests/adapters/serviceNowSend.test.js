'use strict';

const { ServiceNowAdapter }      = require('../../src/integrations/adapters/servicenow/ServiceNowAdapter');
const { ExternalTicketService, AUDIT_ACTIONS } = require('../../src/integrations/ExternalTicketService');
const { InMemoryHttpClient }     = require('../../src/integrations/http/InMemoryHttpClient');
const { Ticket }                 = require('../../src/domain/Ticket');
const { auditService }           = require('../../src/services/AuditService');

// ServiceNow Erfolgs-Response (Table API Format)
const SN_SUCCESS_RESPONSE = {
  result: {
    sys_id:   'abc123def456',
    number:   'INC0012345',
    state:    '1',
    priority: '2',
  },
};

const TICKET = new Ticket({
  id:       'ticket-uuid-001',
  ticketNr: 'INC-2026-00842',
  title:    'Suspicious PowerShell C2 Beacon',
  priority: 'high',
  status:   'open',
  analyst:  'j.mueller',
  srcIp:    '192.168.243.45',
  dstIp:    '185.220.101.47',
  mitre:    'T1059.001',
  description: 'C2-Traffic erkannt.',
  iocs:     '185.220.101.47',
});

beforeEach(() => auditService.clearLog());

// ── InMemoryHttpClient ─────────────────────────────────────

describe('InMemoryHttpClient', () => {
  test('zeichnet Request auf', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(201, SN_SUCCESS_RESPONSE);
    await http.post('https://example.com/api', { test: 1 });
    expect(http.requestCount()).toBe(1);
    expect(http.getLastRequest().url).toContain('example.com');
    expect(http.getLastRequest().method).toBe('POST');
  });

  test('liefert Queue-Response', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(201, { result: { sys_id: 'xyz' } });
    const { data } = await http.post('https://x.com', {});
    expect(data.result.sys_id).toBe('xyz');
  });

  test('wirft bei 4xx-Status', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(403, { error: 'Forbidden' });
    await expect(http.post('https://x.com', {})).rejects.toThrow('HTTP 403');
  });

  test('mockUrl() reagiert auf URL-Pattern', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/now/table', 201, SN_SUCCESS_RESPONSE);
    const { data } = await http.post('https://snow.example/api/now/table/incident', {});
    expect(data.result.number).toBe('INC0012345');
  });
});

// ── ServiceNowAdapter.sendTicket() ─────────────────────────

describe('ServiceNowAdapter.sendTicket()', () => {
  function makeAdapter(responses = []) {
    const http = new InMemoryHttpClient();
    responses.forEach(([status, data]) => http.queueResponse(status, data));
    return {
      adapter: new ServiceNowAdapter({
        baseUrl:    'https://snow.test',
        username:   'soc_api',
        password:   'secret123',
        httpClient: http,
      }),
      http,
    };
  }

  test('sendet POST an Table API und gibt externalId zurück', async () => {
    const { adapter, http } = makeAdapter([[201, SN_SUCCESS_RESPONSE]]);
    const result = await adapter.sendTicket(TICKET);

    expect(result.externalId).toBe('abc123def456');
    expect(result.externalRef).toBe('INC0012345');
    expect(result.externalUrl).toContain('abc123def456');

    const req = http.getLastRequest();
    expect(req.url).toBe('https://snow.test/api/now/table/incident');
    expect(req.method).toBe('POST');
  });

  test('setzt korrekten Authorization Basic Header', async () => {
    const { adapter, http } = makeAdapter([[201, SN_SUCCESS_RESPONSE]]);
    await adapter.sendTicket(TICKET);

    const req      = http.getLastRequest();
    const expected = 'Basic ' + Buffer.from('soc_api:secret123').toString('base64');
    expect(req.headers.Authorization).toBe(expected);
  });

  test('Payload enthält correct ServiceNow Felder', async () => {
    const { adapter, http } = makeAdapter([[201, SN_SUCCESS_RESPONSE]]);
    await adapter.sendTicket(TICKET);

    const body = http.getLastRequest().body;
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    expect(parsed.short_description).toBe('Suspicious PowerShell C2 Beacon');
    expect(parsed.priority).toBe('2');          // high
    expect(parsed.state).toBe('1');             // open
    expect(parsed.category).toBe('security');
    expect(parsed.correlation_id).toContain('soc:');
    expect(parsed.work_notes).toContain('T1059.001');
  });

  test('ServiceNow 401 → klarer Fehler', async () => {
    const { adapter } = makeAdapter([[401, { error: 'Unauthorized' }]]);
    await expect(adapter.sendTicket(TICKET)).rejects.toThrow('HTTP 401');
  });

  test('ServiceNow 500 → klarer Fehler', async () => {
    const { adapter } = makeAdapter([[500, { error: 'Internal Server Error' }]]);
    await expect(adapter.sendTicket(TICKET)).rejects.toThrow('HTTP 500');
  });

  test('fehlende baseUrl → klarer Fehler', async () => {
    const adapter = new ServiceNowAdapter({ username: 'u', password: 'p' });
    await expect(adapter.sendTicket(TICKET)).rejects.toThrow('BASE_URL');
  });

  test('fehlende Credentials → klarer Fehler', async () => {
    const adapter = new ServiceNowAdapter({ baseUrl: 'https://snow.test' });
    await expect(adapter.sendTicket(TICKET)).rejects.toThrow('Credentials');
  });

  test('Antwort ohne sys_id → Fehler', async () => {
    const { adapter } = makeAdapter([[201, { result: { number: 'INC001' } }]]);
    await expect(adapter.sendTicket(TICKET)).rejects.toThrow('sys_id');
  });
});

// ── ExternalTicketService.exportTicket() ──────────────────

describe('ExternalTicketService.exportTicket() — mit InMemoryHttpClient', () => {
  function makeService() {
    const http = new InMemoryHttpClient();
    http.queueResponse(201, SN_SUCCESS_RESPONSE);
    const adapter = new ServiceNowAdapter({
      baseUrl: 'https://snow.test', username: 'u', password: 'p', httpClient: http,
    });
    const service = new ExternalTicketService({ servicenow: adapter });
    return { service, http };
  }

  test('Erfolg → ExternalLink wird gespeichert', async () => {
    const { service } = makeService();
    const result = await service.exportTicket(TICKET, 'servicenow');

    expect(result.status).toBe('exported');
    expect(result.externalId).toBe('abc123def456');
    expect(result.link).toBeDefined();
    expect(result.link.externalSystem).toBe('servicenow');
    expect(result.link.syncStatus).toBe('synced');
  });

  test('Erfolg → EXTERNAL_TICKET_EXPORT_SUCCESS Audit-Event', async () => {
    const { service } = makeService();
    await service.exportTicket(TICKET, 'servicenow');

    const log = auditService.getLog();
    expect(log.some(e => e.action === AUDIT_ACTIONS.EXPORT_SUCCESS)).toBe(true);
    const ev = log.find(e => e.action === AUDIT_ACTIONS.EXPORT_SUCCESS);
    expect(ev.metadata.system).toBe('servicenow');
    expect(ev.metadata.externalRef).toBe('INC0012345');
  });

  test('Fehler → EXTERNAL_TICKET_EXPORT_FAILED Audit-Event', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(503, { error: 'Service Unavailable' });
    const adapter = new ServiceNowAdapter({
      baseUrl: 'https://snow.test', username: 'u', password: 'p', httpClient: http,
    });
    const service = new ExternalTicketService({ servicenow: adapter });

    await expect(service.exportTicket(TICKET, 'servicenow')).rejects.toThrow();
    const log = auditService.getLog();
    expect(log.some(e => e.action === AUDIT_ACTIONS.EXPORT_FAILED)).toBe(true);
  });
});
