'use strict';

// Layer 2: read-only Verbindungstest + reconfigure der Outbound-Adapter
// (ServiceNow/OTRS). Deckt die neuen Adapter-Methoden `reconfigure` und
// `testConnection` direkt ab (Erfolg + Fehler + Guards) — mit InMemoryHttpClient,
// ohne echten Netzwerk-Call.

const { ServiceNowAdapter } = require('../../src/integrations/adapters/servicenow/ServiceNowAdapter');
const { OTRSAdapter }       = require('../../src/integrations/adapters/otrs/OTRSAdapter');
const { ExternalTicketService } = require('../../src/integrations/ExternalTicketService');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

describe('ServiceNowAdapter.reconfigure + testConnection', () => {
  test('reconfigure setzt Felder; testConnection macht read-only GET (Table + limit + Basic-Auth)', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, { result: [{ sys_id: 'x' }] });
    const a = new ServiceNowAdapter({ httpClient: http });
    a.reconfigure({ baseUrl: 'https://acme.service-now.com', username: 'soc', password: 'pw', table: 'sn_si_incident' });

    await expect(a.testConnection()).resolves.toBeUndefined();
    const req = http.getLastRequest();
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://acme.service-now.com/api/now/table/sn_si_incident?sysparm_limit=1');
    // Basic-Auth aus reconfigure-Credentials — nie im Klartext im Header.
    expect(req.headers.Authorization).toBe(`Basic ${Buffer.from('soc:pw').toString('base64')}`);
  });

  test('401 vom Server → wirft (Auth fehlgeschlagen)', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(401, { error: 'unauthorized' });
    const a = new ServiceNowAdapter({ httpClient: http });
    a.reconfigure({ baseUrl: 'https://acme.service-now.com', username: 'soc', password: 'bad', table: 'incident' });
    await expect(a.testConnection()).rejects.toThrow();
  });

  test('ohne Base-URL / Credentials → wirft ohne Netzwerk-Call', async () => {
    const http = new InMemoryHttpClient();
    const a = new ServiceNowAdapter({ httpClient: http });
    a.reconfigure({ baseUrl: '', username: '', password: '' });
    await expect(a.testConnection()).rejects.toThrow(/Base-URL|Credentials/);
    expect(http.requestCount()).toBe(0);
  });
});

describe('OTRSAdapter.reconfigure + testConnection', () => {
  test('reconfigure setzt Felder; testConnection macht SessionCreate (read-only, Credentials im Body)', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, { SessionID: 'sess-123' });
    const a = new OTRSAdapter({ httpClient: http });
    a.reconfigure({ baseUrl: 'https://otrs.acme.local', username: 'agent', password: 'pw', webService: 'WS' });

    await expect(a.testConnection()).resolves.toBeUndefined();
    const req = http.getLastRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://otrs.acme.local/nph-genericinterface.pl/Webservice/WS/SessionCreate');
    expect(req.body).toMatchObject({ UserLogin: 'agent', Password: 'pw' });
  });

  test('OTRS-Error im Body → wirft (kein Ticket angelegt)', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, { Error: { ErrorCode: 'AuthFail', ErrorMessage: 'invalid' } });
    const a = new OTRSAdapter({ httpClient: http });
    a.reconfigure({ baseUrl: 'https://otrs.acme.local', username: 'agent', password: 'bad' });
    await expect(a.testConnection()).rejects.toThrow(/AuthFail|invalid/);
  });

  test('Antwort ohne SessionID → wirft (WebService/Operation falsch)', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, {});
    const a = new OTRSAdapter({ httpClient: http });
    a.reconfigure({ baseUrl: 'https://otrs.acme.local', username: 'agent', password: 'pw' });
    await expect(a.testConnection()).rejects.toThrow(/SessionID/);
  });

  test('ohne Base-URL / Credentials → wirft ohne Netzwerk-Call', async () => {
    const http = new InMemoryHttpClient();
    const a = new OTRSAdapter({ httpClient: http });
    a.reconfigure({ baseUrl: '', username: '', password: '' });
    await expect(a.testConnection()).rejects.toThrow(/Base-URL|Credentials/);
    expect(http.requestCount()).toBe(0);
  });
});

describe('ExternalTicketService.reconfigureAdapter', () => {
  test('delegiert an den registrierten Adapter; No-op bei unbekanntem System', () => {
    const sn = new ServiceNowAdapter({ httpClient: new InMemoryHttpClient() });
    const svc = new ExternalTicketService({ servicenow: sn });
    svc.reconfigureAdapter('servicenow', { baseUrl: 'https://x.service-now.com', username: 'u', password: 'p' });
    expect(sn.tableApiUrl).toBe('https://x.service-now.com/api/now/table/incident');
    // Unbekanntes System darf nicht werfen.
    expect(() => svc.reconfigureAdapter('unknown', { baseUrl: 'https://y' })).not.toThrow();
  });
});
