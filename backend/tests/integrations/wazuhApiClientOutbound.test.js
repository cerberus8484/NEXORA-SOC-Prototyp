'use strict';

const { WazuhApiClient }     = require('../../src/integrations/adapters/wazuh/WazuhApiClient');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

const CREDS = { url: 'https://wazuh:55000', user: 'wazuh', password: 'secret' };
const FILE = 'soc_fp_exceptions.xml';

function client(setup) {
  const http = new InMemoryHttpClient();
  http.mockUrl('/security/user/authenticate', 200, 'tok');
  setup(http);
  return { c: new WazuhApiClient({ ...CREDS, http }), http };
}

describe('WazuhApiClient — Outbound (Rule-File + Manager)', () => {
  test('getRuleFile liefert Roh-XML (raw=true, Bearer)', async () => {
    const { c, http } = client((h) => h.mockUrl(`/rules/files/${FILE}`, 200, '<group name="soc_fp_exceptions,"></group>'));
    const xml = await c.getRuleFile(FILE);
    expect(xml).toContain('soc_fp_exceptions');
    const req = http.getRequests().find((r) => r.url.includes('/rules/files/'));
    expect(req.method).toBe('GET');
    expect(req.url).toContain('raw=true');
    expect(req.headers.Authorization).toBe('Bearer tok');
  });

  test('getRuleFile → 404 ⇒ leerer String (Datei existiert noch nicht)', async () => {
    const { c } = client((h) => h.mockUrl(`/rules/files/${FILE}`, 404, { error: 'not found' }));
    expect(await c.getRuleFile(FILE)).toBe('');
  });

  test('putRuleFile: PUT overwrite=true, octet-stream, Body = XML', async () => {
    const { c, http } = client((h) => h.mockUrl(`/rules/files/${FILE}`, 200, { data: { message: 'ok' } }));
    await c.putRuleFile(FILE, '<group name="soc_fp_exceptions,"></group>');
    const req = http.getRequests().find((r) => r.method === 'PUT' && r.url.includes('/rules/files/'));
    expect(req.url).toContain('overwrite=true');
    expect(req.headers['Content-Type']).toBe('application/octet-stream');
    expect(req.body).toContain('<group name="soc_fp_exceptions,">');
  });

  test('validateConfiguration OK', async () => {
    const { c } = client((h) => h.mockUrl('/manager/configuration/validation', 200, { data: { status: 'OK' } }));
    expect((await c.validateConfiguration()).ok).toBe(true);
  });

  test('validateConfiguration KO', async () => {
    const { c } = client((h) => h.mockUrl('/manager/configuration/validation', 200, { data: { status: 'KO', details: 'bad rule' } }));
    const v = await c.validateConfiguration();
    expect(v.ok).toBe(false);
    expect(v.status).toBe('KO');
  });

  test('restartManager ruft PUT /manager/restart', async () => {
    const { c, http } = client((h) => h.mockUrl('/manager/restart', 200, { data: { affected_items: ['manager'] } }));
    await c.restartManager();
    expect(http.getRequests().some((r) => r.method === 'PUT' && r.url.includes('/manager/restart'))).toBe(true);
  });

  // Regression: Der Manager-Restart killt die eigene API mitten in der Antwort
  // (ECONNRESET) → das ist ERWARTET, kein Fehler. Erfolg per Status-Polling
  // bestätigen statt 422 zu melden (Live-Befund 2026-06-14, analysisd kam hoch).
  describe('restartManager — Verbindungsabbruch ist Erfolg', () => {
    // Fake-HTTP: Restart wirft ECONNRESET, Status erst ECONNREFUSED, dann running.
    class DropHttp {
      constructor({ statusUpAfter }) { this.calls = []; this._n = 0; this._upAfter = statusUpAfter; }
      async request(url, options = {}) {
        this.calls.push({ url, ...options });
        if (url.includes('/security/user/authenticate')) return { status: 200, data: 'tok' };
        if (url.includes('/manager/restart')) { const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e; }
        if (url.includes('/manager/status')) {
          this._n += 1;
          if (this._n < this._upAfter) { const e = new Error('connect ECONNREFUSED'); e.code = 'ECONNREFUSED'; throw e; }
          return { status: 200, data: { data: { affected_items: [{ 'wazuh-analysisd': 'running' }] } } };
        }
        return { status: 200, data: {} };
      }
    }

    test('Abbruch beim Restart → Erfolg über Status-Polling (analysisd running)', async () => {
      const http = new DropHttp({ statusUpAfter: 2 }); // erst ECONNREFUSED, dann running
      const c = new WazuhApiClient({ ...CREDS, http, restartPoll: { delayMs: 0, attempts: 5 } });
      const r = await c.restartManager();
      expect(r.confirmed).toBe(true);
      expect(http.calls.some((x) => x.url.includes('/manager/status'))).toBe(true);
    });

    test('Manager kommt nicht zurück → wirft (kein stiller Erfolg)', async () => {
      const http = new DropHttp({ statusUpAfter: 999 });
      const c = new WazuhApiClient({ ...CREDS, http, restartPoll: { delayMs: 0, attempts: 3 } });
      await expect(c.restartManager()).rejects.toThrow();
    });

    test('echter HTTP-Fehler (403) wird NICHT als Erfolg behandelt', async () => {
      const http = new InMemoryHttpClient();
      http.mockUrl('/security/user/authenticate', 200, 'tok');
      http.mockUrl('/manager/restart', 403, { error: 'forbidden' });
      const c = new WazuhApiClient({ ...CREDS, http, restartPoll: { delayMs: 0, attempts: 2 } });
      await expect(c.restartManager()).rejects.toThrow();
    });
  });

  test('ohne Credentials: getRuleFile = "", putRuleFile/restart werfen', async () => {
    const c = new WazuhApiClient({ http: new InMemoryHttpClient() });
    expect(c.isEnabled()).toBe(false);
    expect(await c.getRuleFile(FILE)).toBe('');
    await expect(c.putRuleFile(FILE, '<x/>')).rejects.toThrow();
    await expect(c.restartManager()).rejects.toThrow();
  });
});
