'use strict';

// Layer 2: Laufzeit-Rekonfiguration der Wazuh-Clients (Verbindung aus der UI ändern,
// ohne Prozess-Neustart) + ping() für den Verbindungstest.
//
// Sichert:
//   - reconfigure() übernimmt url/user/password und INVALIDIERT den Token-Cache
//     (sonst liefe der API-Client bis zu ~13 min mit dem alten Token weiter),
//   - reconfigure() normalisiert die URL (trailing slash) wie der Konstruktor,
//   - ping() authentifiziert (API) bzw. prüft Erreichbarkeit (Indexer) und
//     propagiert Fehler sichtbar (kein still verschlucktes false).

const { WazuhApiClient }     = require('../../src/integrations/adapters/wazuh/WazuhApiClient');
const { WazuhIndexerClient } = require('../../src/integrations/adapters/wazuh/WazuhIndexerClient');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

const CREDS = { url: 'https://wazuh:55000', user: 'wazuh', password: 'secret' };

describe('WazuhApiClient.reconfigure', () => {
  test('übernimmt neue Creds und invalidiert den Token-Cache', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, 'token-alt');
    http.queueResponse(200, { data: { affected_items: [] } });
    const c = new WazuhApiClient({ ...CREDS, http });
    await c.listAgents(); // cached Token 'token-alt'

    c.reconfigure({ url: 'https://neu:55000/', user: 'neu-user', password: 'neu-pass' });

    http.queueResponse(200, 'token-neu');
    http.queueResponse(200, { data: { affected_items: [] } });
    await c.listAgents();

    const reqs = http.getRequests();
    const secondAuth = reqs.filter((r) => r.url.includes('/security/user/authenticate'))[1];
    expect(secondAuth).toBeDefined(); // Cache wurde invalidiert → neue Auth
    expect(secondAuth.url).toBe('https://neu:55000/security/user/authenticate?raw=true'); // Slash normalisiert
    const expectedBasic = Buffer.from('neu-user:neu-pass').toString('base64');
    expect(secondAuth.headers.Authorization).toBe(`Basic ${expectedBasic}`);
  });

  test('reconfigure auf leere Werte → isEnabled() false', () => {
    const c = new WazuhApiClient({ ...CREDS, http: new InMemoryHttpClient() });
    expect(c.isEnabled()).toBe(true);
    c.reconfigure({ url: '', user: '', password: '' });
    expect(c.isEnabled()).toBe(false);
  });
});

describe('WazuhApiClient.ping', () => {
  test('erfolgreiche Auth → { ok: true }', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, 'tok');
    const c = new WazuhApiClient({ ...CREDS, http });
    await expect(c.ping()).resolves.toEqual({ ok: true });
  });

  test('401 → Fehler propagiert (kein stilles false)', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(401, { title: 'Unauthorized' });
    const c = new WazuhApiClient({ ...CREDS, http });
    await expect(c.ping()).rejects.toThrow(/401/);
  });

  test('nicht konfiguriert → wirft mit klarer Meldung', async () => {
    const c = new WazuhApiClient({ http: new InMemoryHttpClient() });
    await expect(c.ping()).rejects.toThrow(/nicht konfiguriert/i);
  });
});

describe('WazuhIndexerClient.reconfigure + ping', () => {
  test('reconfigure übernimmt neue Creds/URL (Slash normalisiert)', async () => {
    const http = new InMemoryHttpClient();
    const c = new WazuhIndexerClient({ url: 'https://idx:9200', user: 'a', password: 'b', http });
    c.reconfigure({ url: 'https://idx-neu:9200/', user: 'n', password: 'p' });

    http.queueResponse(200, { cluster_name: 'wazuh' });
    await c.ping();

    const req = http.getLastRequest();
    expect(req.url).toBe('https://idx-neu:9200/');
    const expectedBasic = Buffer.from('n:p').toString('base64');
    expect(req.headers.Authorization).toBe(`Basic ${expectedBasic}`);
  });

  test('ping: erreichbar → { ok: true }; 401 → Fehler propagiert', async () => {
    const http = new InMemoryHttpClient();
    http.queueResponse(200, { cluster_name: 'wazuh' });
    const c = new WazuhIndexerClient({ url: 'https://idx:9200', user: 'a', password: 'b', http });
    await expect(c.ping()).resolves.toEqual({ ok: true });

    http.queueResponse(401, {});
    await expect(c.ping()).rejects.toThrow(/401/);
  });

  test('ping: nicht konfiguriert → wirft mit klarer Meldung', async () => {
    const c = new WazuhIndexerClient({ http: new InMemoryHttpClient() });
    await expect(c.ping()).rejects.toThrow(/nicht konfiguriert/i);
  });

  test('reconfigure übernimmt index/vulnIndex, wenn übergeben; behält sie sonst', () => {
    const http = new InMemoryHttpClient();
    const c = new WazuhIndexerClient({ url: 'https://idx:9200', user: 'a', password: 'b', index: 'orig-*', vulnIndex: 'orig-vuln-*', http });
    // Ohne index/vulnIndex im Patch → bisherige Werte bleiben erhalten.
    c.reconfigure({ url: 'https://idx2:9200', user: 'x', password: 'y' });
    expect(c._index).toBe('orig-*');
    expect(c._vulnIndex).toBe('orig-vuln-*');
    // Mit neuen Werten → übernommen.
    c.reconfigure({ url: 'https://idx3:9200', user: 'x', password: 'y', index: 'neu-*', vulnIndex: 'neu-vuln-*' });
    expect(c._index).toBe('neu-*');
    expect(c._vulnIndex).toBe('neu-vuln-*');
  });
});
