'use strict';

const { WazuhApiClient }      = require('../../src/integrations/adapters/wazuh/WazuhApiClient');
const { InMemoryHttpClient }  = require('../../src/integrations/http/InMemoryHttpClient');

const CREDS = { url: 'https://wazuh:55000', user: 'wazuh', password: 'secret' };

const AGENT = {
  id: '001', name: 'WINCLIENT', ip: '192.168.241.102',
  status: 'active', group: ['default'], os: { name: 'Microsoft Windows 10', version: '10.0.19045' },
};

describe('WazuhApiClient', () => {
  test('isEnabled false ohne Credentials → getAgent gibt null', async () => {
    const c = new WazuhApiClient({ http: new InMemoryHttpClient() });
    expect(c.isEnabled()).toBe(false);
    expect(await c.getAgent('001')).toBeNull();
  });

  test('getAgent authentifiziert (Basic) und liefert den Agent', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, 'jwt-token-123');                       // authenticate (raw=true)
    http.queueResponse(200, { data: { affected_items: [AGENT] } }); // /agents

    const c = new WazuhApiClient({ ...CREDS, http });
    const agent = await c.getAgent('001');

    expect(agent.name).toBe('WINCLIENT');
    expect(agent.os.name).toBe('Microsoft Windows 10');

    const reqs = http.getRequests();
    expect(reqs[0].url).toContain('/security/user/authenticate');
    expect(reqs[0].headers.Authorization).toMatch(/^Basic /);
    expect(reqs[1].url).toContain('/agents?agents_list=001');
    expect(reqs[1].headers.Authorization).toBe('Bearer jwt-token-123');
  });

  test('listAgents liefert die registrierten Agents', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'tok');
    http.mockUrl('/agents', 200, { data: { affected_items: [AGENT, { id: '002', name: 'SRV', status: 'disconnected' }] } });

    const c = new WazuhApiClient({ ...CREDS, http });
    const agents = await c.listAgents();
    expect(agents.length).toBe(2);
    expect(agents[1].status).toBe('disconnected');
  });

  test('getAgentInventory aggregiert syscollector (OS, Hardware, Netz, Zähler)', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'tok');
    http.mockUrl('/syscollector/001/os',        200, { data: { affected_items: [{ os: { name: 'Windows 10' }, hostname: 'WIN01' }] } });
    http.mockUrl('/syscollector/001/hardware',  200, { data: { affected_items: [{ cpu: { name: 'i7' }, ram: { total: 16384 } }] } });
    http.mockUrl('/syscollector/001/netiface',  200, { data: { affected_items: [{ name: 'eth0' }, { name: 'lo' }] } });
    http.mockUrl('/syscollector/001/packages',  200, { data: { total_affected_items: 1200, affected_items: [] } });
    http.mockUrl('/syscollector/001/ports',     200, { data: { total_affected_items: 12, affected_items: [] } });
    http.mockUrl('/syscollector/001/processes', 200, { data: { total_affected_items: 87, affected_items: [] } });

    const c = new WazuhApiClient({ ...CREDS, http });
    const inv = await c.getAgentInventory('001');
    expect(inv.os.hostname).toBe('WIN01');
    expect(inv.hardware.ram.total).toBe(16384);
    expect(inv.interfaces.length).toBe(2);
    expect(inv.packagesTotal).toBe(1200);
    expect(inv.portsTotal).toBe(12);
    expect(inv.processesTotal).toBe(87);
  });

  test('getNetInterfaces nutzt nur gueltige select-Felder (name,mac — KEIN ipv4 → kein HTTP 400)', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'tok');
    http.mockUrl('/syscollector/001/netiface', 200, { data: { affected_items: [
      { name: 'Ethernet', mac: 'bc:24:11:7b:45:69' }, { name: 'Loopback', mac: '00:00:00:00:00:00' },
    ] } });

    const c = new WazuhApiClient({ ...CREDS, http });
    const ifaces = await c.getNetInterfaces('001');
    expect(ifaces.length).toBe(2);

    const req = http.getRequests().find((r) => r.url.includes('/syscollector/001/netiface'));
    expect(req.url).toContain('select=name,mac');
    // ipv4 ist KEIN netiface-Feld (IPs liegen in netaddr) → würde Wazuh HTTP 400 auslösen.
    expect(req.url).not.toContain('ipv4');
  });

  test('getAgentPackages baut Query (select/limit/offset/sort) und mappt items+total', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'tok');
    http.mockUrl('/syscollector/001/packages', 200, { data: {
      total_affected_items: 710,
      affected_items: [{ name: 'curl', version: '8.5.0', vendor: 'Ubuntu', architecture: 'amd64' }],
    } });

    const c = new WazuhApiClient({ ...CREDS, http });
    const out = await c.getAgentPackages('001', { limit: 50, offset: 10 });

    expect(out.total).toBe(710);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].name).toBe('curl');

    const req = http.getRequests().find((r) => r.url.includes('/syscollector/001/packages'));
    expect(req.url).toContain('select=name,version,vendor,architecture');
    expect(req.url).toContain('limit=50');
    expect(req.url).toContain('offset=10');
    expect(req.url).toContain('sort=name');
    expect(req.url).not.toContain('search='); // kein search-Param ohne search
  });

  test('getAgentPackages cappt limit auf 200 und URL-encodiert search', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/security/user/authenticate', 200, 'tok');
    http.mockUrl('/syscollector/001/packages', 200, { data: { total_affected_items: 0, affected_items: [] } });

    const c = new WazuhApiClient({ ...CREDS, http });
    await c.getAgentPackages('001', { limit: 9999, search: 'open ssl' });

    const req = http.getRequests().find((r) => r.url.includes('/syscollector/001/packages'));
    expect(req.url).toContain('limit=200');     // hartes Cap
    expect(req.url).not.toContain('limit=9999');
    expect(req.url).toContain('search=open%20ssl'); // URL-encodiert
  });

  test('getAgentPackages ohne Credentials → { items:[], total:0 } (isEnabled-Guard)', async () => {
    const c = new WazuhApiClient({ http: new InMemoryHttpClient() });
    expect(await c.getAgentPackages('001')).toEqual({ items: [], total: 0 });
  });

  test('Token wird gecacht — zweiter Call ohne erneutes authenticate', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, 'jwt-token-123');
    http.queueResponse(200, { data: { affected_items: [AGENT] } });
    http.queueResponse(200, { data: { affected_items: [AGENT] } });

    const c = new WazuhApiClient({ ...CREDS, http });
    await c.getAgent('001');
    await c.getAgent('001');

    const auths = http.getRequests().filter((r) => r.url.includes('/security/user/authenticate'));
    expect(auths.length).toBe(1); // nur einmal authentifiziert
  });
});
