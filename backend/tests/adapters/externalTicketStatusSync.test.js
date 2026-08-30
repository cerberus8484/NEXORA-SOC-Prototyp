'use strict';

// ── ServiceNow/OTRS updateTicketStatus + ExternalTicketService.syncStatus ─────

const { ServiceNowAdapter } = require('../../src/integrations/adapters/servicenow/ServiceNowAdapter');
const { OTRSAdapter }       = require('../../src/integrations/adapters/otrs/OTRSAdapter');
const { ExternalTicketService, AUDIT_ACTIONS } = require('../../src/integrations/ExternalTicketService');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');
const { Ticket }            = require('../../src/domain/Ticket');
const { auditService }      = require('../../src/services/AuditService');

const SN_CREATE = { result: { sys_id: 'sys-1', number: 'INC0012345', state: '1' } };
const TICKET_OPEN = new Ticket({ id: 't-1', ticketNr: 'INC-1', title: 'X', priority: 'high', status: 'open' });
const TICKET_PROGRESS = new Ticket({ id: 't-1', ticketNr: 'INC-1', title: 'X', priority: 'high', status: 'progress' });

beforeEach(() => auditService.clearLog());

describe('ServiceNowAdapter.updateTicketStatus()', () => {
  test('PATCHt /table/{sys_id} mit gemapptem state + Basic-Auth', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, { result: { sys_id: 'sys-1', state: '2' } });
    const adapter = new ServiceNowAdapter({ baseUrl: 'https://snow.test', username: 'u', password: 'p', httpClient: http });

    const res = await adapter.updateTicketStatus('sys-1', 'progress');

    const req = http.getLastRequest();
    expect(req.method).toBe('PATCH');
    expect(req.url).toBe('https://snow.test/api/now/table/incident/sys-1');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    expect(body.state).toBe('2'); // progress → '2'
    expect(req.headers.Authorization).toBe('Basic ' + Buffer.from('u:p').toString('base64'));
    expect(res.externalStatus).toBe('2');
  });

  test('ohne externalId → Fehler', async () => {
    const adapter = new ServiceNowAdapter({ baseUrl: 'https://snow.test', username: 'u', password: 'p' });
    await expect(adapter.updateTicketStatus('', 'open')).rejects.toThrow('externalId');
  });

  test('ohne baseUrl → Fehler', async () => {
    const adapter = new ServiceNowAdapter({ username: 'u', password: 'p' });
    await expect(adapter.updateTicketStatus('sys-1', 'open')).rejects.toThrow('BASE_URL');
  });
});

describe('OTRSAdapter.updateTicketStatus()', () => {
  test('POSTet TicketUpdate mit State + Credentials im Body', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, { TicketID: '42', TicketNumber: 'TN-42' });
    const adapter = new OTRSAdapter({ baseUrl: 'https://otrs.test', username: 'u', password: 'p', httpClient: http });

    const res = await adapter.updateTicketStatus('42', 'closed');

    const req = http.getLastRequest();
    expect(req.url).toContain('/TicketUpdate');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    expect(body.TicketID).toBe('42');
    expect(body.UserLogin).toBe('u');
    expect(body.Ticket.State).toBe('closed successful'); // closed → OTRS_STATE
    expect(res.externalId).toBe('42');
  });

  test('OTRS-Fehler im Body → wirft', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, { Error: { ErrorCode: 'TicketUpdate.AccessDenied', ErrorMessage: 'denied' } });
    const adapter = new OTRSAdapter({ baseUrl: 'https://otrs.test', username: 'u', password: 'p', httpClient: http });
    await expect(adapter.updateTicketStatus('42', 'open')).rejects.toThrow('OTRS Fehler');
  });
});

describe('ExternalTicketService.syncStatus()', () => {
  function makeService() {
    const http = new InMemoryHttpClient();
    const adapter = new ServiceNowAdapter({ baseUrl: 'https://snow.test', username: 'u', password: 'p', httpClient: http });
    return { service: new ExternalTicketService({ servicenow: adapter }), http };
  }

  test('nach Export: synct den Status + SUCCESS-Audit', async () => {
    const { service, http } = makeService();
    http.queueResponse(201, SN_CREATE);                                 // Export (create)
    http.queueResponse(200, { result: { sys_id: 'sys-1', state: '2' } }); // Sync (patch)

    await service.exportTicket(TICKET_OPEN, 'servicenow');              // legt ExternalLink an
    const res = await service.syncStatus(TICKET_PROGRESS, 'servicenow');

    expect(res.status).toBe('synced');
    expect(res.externalId).toBe('sys-1');
    expect(http.getLastRequest().method).toBe('PATCH');
    expect(auditService.getLog().some((e) => e.action === AUDIT_ACTIONS.STATUS_SYNC_SUCCESS)).toBe(true);
  });

  test('ohne vorherigen Export → Fehler + FAILED-Audit', async () => {
    const { service } = makeService();
    await expect(service.syncStatus(TICKET_OPEN, 'servicenow')).rejects.toThrow(/Export-Link/);
    expect(auditService.getLog().some((e) => e.action === AUDIT_ACTIONS.STATUS_SYNC_FAILED)).toBe(true);
  });
});
