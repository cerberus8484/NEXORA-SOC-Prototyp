'use strict';

// Slice 2: CrowdsecLapiClient — holt WAN-Alerts vom Webserver-CrowdSec (LAPI).
// /v1/alerts braucht Machine-Auth (JWT via /v1/watchers/login). Der Client ist
// transportunabhängig getestet: injizierter Fake-HTTP-Client, kein echtes Netz.

const { CrowdsecLapiClient } = require('../../src/integrations/adapters/crowdsec/CrowdsecLapiClient');
const { CrowdsecAdapter }    = require('../../src/integrations/adapters/crowdsec/CrowdsecAdapter');
const { alertSchema }        = require('../../src/integrations/adapters/crowdsec/crowdsecSchemas');

// Minimaler Fake-HTTP-Client nach RealHttpClient-Vertrag: request(url,opts) -> {status,data}.
function makeHttp(routes) {
  const calls = [];
  return {
    calls,
    async request(url, opts = {}) {
      calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
      for (const r of routes) {
        if (r.test(url, opts)) {
          const t = typeof r.throw === 'function' ? r.throw() : r.throw;
          if (t) throw Object.assign(new Error('HTTP ' + t), { status: t });
          return { status: r.status || 200, data: typeof r.data === 'function' ? r.data() : r.data };
        }
      }
      throw Object.assign(new Error('HTTP 404: no route ' + url), { status: 404 });
    },
  };
}

const CFG = { baseUrl: 'https://web.example:8080', machineId: 'nexora', password: 'secret' };

const SAMPLE_ALERT = {
  id: 42,
  scenario: 'crowdsecurity/http-bruteforce',
  message: '5 attempts',
  events_count: 5,
  created_at: '2026-06-19T22:00:00Z',
  source: { scope: 'Ip', value: '185.10.20.30', as_name: 'EvilNet', cn: 'RU' },
  decisions: [{ origin: 'crowdsec', type: 'ban', scope: 'Ip', value: '185.10.20.30', duration: '4h' }],
};

describe('CrowdsecLapiClient', () => {
  test('isConfigured: false ohne vollständige Config, true mit', () => {
    expect(new CrowdsecLapiClient({ httpClient: makeHttp([]) }).isConfigured()).toBe(false);
    expect(new CrowdsecLapiClient({ ...CFG, httpClient: makeHttp([]) }).isConfigured()).toBe(true);
  });

  test('login(): POST /v1/watchers/login mit machine_id+password, Token wird übernommen', async () => {
    const http = makeHttp([
      { test: (u) => u.endsWith('/v1/watchers/login'), data: { token: 'JWT1', expire: '2999-01-01T00:00:00Z' } },
    ]);
    const client = new CrowdsecLapiClient({ ...CFG, httpClient: http });
    const token = await client.login();

    expect(token).toBe('JWT1');
    const loginCall = http.calls.find((c) => c.url.endsWith('/v1/watchers/login'));
    expect(loginCall.method).toBe('POST');
    const body = JSON.parse(typeof loginCall.body === 'string' ? loginCall.body : JSON.stringify(loginCall.body));
    expect(body).toEqual({ machine_id: 'nexora', password: 'secret' });
  });

  test('fetchAlerts(): loggt zuerst ein, ruft /v1/alerts mit Bearer, liefert Alert-Array', async () => {
    const http = makeHttp([
      { test: (u) => u.endsWith('/v1/watchers/login'), data: { token: 'JWT1', expire: '2999-01-01T00:00:00Z' } },
      { test: (u) => u.includes('/v1/alerts'), data: [SAMPLE_ALERT] },
    ]);
    const client = new CrowdsecLapiClient({ ...CFG, httpClient: http });
    const alerts = await client.fetchAlerts();

    expect(alerts).toHaveLength(1);
    expect(alerts[0].scenario).toBe('crowdsecurity/http-bruteforce');
    const alertCall = http.calls.find((c) => c.url.includes('/v1/alerts'));
    expect(alertCall.headers.Authorization).toBe('Bearer JWT1');
  });

  test('fetchAlerts({since}): hängt since als Query an', async () => {
    const http = makeHttp([
      { test: (u) => u.endsWith('/v1/watchers/login'), data: { token: 'JWT1', expire: '2999-01-01T00:00:00Z' } },
      { test: (u) => u.includes('/v1/alerts'), data: [] },
    ]);
    const client = new CrowdsecLapiClient({ ...CFG, httpClient: http });
    await client.fetchAlerts({ since: '2h' });
    const alertCall = http.calls.find((c) => c.url.includes('/v1/alerts'));
    expect(alertCall.url).toContain('since=2h');
  });

  test('401 bei Alerts → genau einmal neu einloggen und erneut versuchen', async () => {
    let alertHits = 0;
    const http = makeHttp([
      { test: (u) => u.endsWith('/v1/watchers/login'), data: () => ({ token: 'JWT-' + Date.now(), expire: '2999-01-01T00:00:00Z' }) },
      {
        test: (u) => u.includes('/v1/alerts'),
        // erster Alerts-Call 401, danach ok
        throw: () => (alertHits++ === 0 ? 401 : undefined),
        data: [SAMPLE_ALERT],
      },
    ]);
    const client = new CrowdsecLapiClient({ ...CFG, httpClient: http });
    const alerts = await client.fetchAlerts();
    expect(alerts).toHaveLength(1);
    // zwei Login-Calls (initial + nach 401), zwei Alert-Versuche
    expect(http.calls.filter((c) => c.url.endsWith('/v1/watchers/login'))).toHaveLength(2);
  });

  test('gültiger Token wird wiederverwendet (kein zweiter Login)', async () => {
    const http = makeHttp([
      { test: (u) => u.endsWith('/v1/watchers/login'), data: { token: 'JWT1', expire: '2999-01-01T00:00:00Z' } },
      { test: (u) => u.includes('/v1/alerts'), data: [] },
    ]);
    const client = new CrowdsecLapiClient({ ...CFG, httpClient: http });
    await client.fetchAlerts();
    await client.fetchAlerts();
    expect(http.calls.filter((c) => c.url.endsWith('/v1/watchers/login'))).toHaveLength(1);
  });

  test('Login-Fehler wird nicht verschluckt (wirft)', async () => {
    const http = makeHttp([{ test: (u) => u.endsWith('/v1/watchers/login'), throw: 403 }]);
    const client = new CrowdsecLapiClient({ ...CFG, httpClient: http });
    await expect(client.fetchAlerts()).rejects.toThrow();
  });

  test('Geholte Alerts sind mit dem Slice-1-Adapter kompatibel (Schema + Ticket-Draft)', async () => {
    const http = makeHttp([
      { test: (u) => u.endsWith('/v1/watchers/login'), data: { token: 'JWT1', expire: '2999-01-01T00:00:00Z' } },
      { test: (u) => u.includes('/v1/alerts'), data: [SAMPLE_ALERT] },
    ]);
    const client  = new CrowdsecLapiClient({ ...CFG, httpClient: http });
    const adapter = new CrowdsecAdapter();
    const [alert] = await client.fetchAlerts();

    expect(alertSchema.validate(alert).error).toBeUndefined();
    expect(() => adapter.validate(alert)).not.toThrow();
    const draft = adapter.toTicketDraft(adapter.normalize(alert));
    expect(draft.srcIp).toBe('185.10.20.30');
    expect(draft.source).toBe('crowdsec');
  });
});
