'use strict';

// Host-Enrollment: WazuhApiClient.addAgent — registriert einen neuen Agent am
// Wazuh-Manager (POST /agents, create). Liefert { id, name, key }; der key ist
// das Enrollment-Secret für die Agent-Installation auf dem Ziel-Host.

const { WazuhApiClient } = require('../../src/integrations/adapters/wazuh/WazuhApiClient');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

const CREDS = { url: 'https://wz:55000', user: 'u', password: 'p' };

function httpWithAgent(agentData) {
  const http = new InMemoryHttpClient();
  http.mockUrl('/security/user/authenticate', 200, 'TOKEN123');
  http.mockUrl('/agents', 200, { data: agentData });
  return http;
}

describe('WazuhApiClient.addAgent', () => {
  test('ohne Config → wirft (nicht konfiguriert)', async () => {
    await expect(new WazuhApiClient({}).addAgent({ name: 'web01' })).rejects.toThrow(/konfiguriert/i);
  });

  test('fehlender Name → wirft', async () => {
    await expect(new WazuhApiClient({ ...CREDS, http: httpWithAgent({ id: '005', key: 'K' }) }).addAgent({}))
      .rejects.toThrow(/name/i);
  });

  test('Happy-Path: registriert Agent, liefert id/name/key + POSTet an /agents', async () => {
    const http = httpWithAgent({ id: '005', key: 'BASE64ENROLLKEY==' });
    const c = new WazuhApiClient({ ...CREDS, http });
    const res = await c.addAgent({ name: 'web01', ip: '10.0.10.20' });
    expect(res).toEqual({ id: '005', name: 'web01', key: 'BASE64ENROLLKEY==' });
    const last = http.getLastRequest();
    expect(last.method).toBe('POST');
    expect(last.url).toContain('/agents');
    const body = typeof last.body === 'string' ? JSON.parse(last.body) : last.body;
    expect(body).toMatchObject({ name: 'web01', ip: '10.0.10.20' });
  });

  test('ohne IP: Body trägt nur den Namen', async () => {
    const http = httpWithAgent({ id: '006', key: 'K2' });
    await new WazuhApiClient({ ...CREDS, http }).addAgent({ name: 'db01' });
    const body = typeof http.getLastRequest().body === 'string' ? JSON.parse(http.getLastRequest().body) : http.getLastRequest().body;
    expect(body).toEqual({ name: 'db01' });
  });

  test('Antwort ohne id/key → wirft (502, unerwartete Antwort)', async () => {
    const c = new WazuhApiClient({ ...CREDS, http: httpWithAgent({ id: '007' }) }); // key fehlt
    await expect(c.addAgent({ name: 'x' })).rejects.toMatchObject({ status: 502 });
  });
});
