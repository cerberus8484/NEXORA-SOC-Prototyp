'use strict';

// Slice 3a: CrowdsecPoller — zieht periodisch Alerts vom Webserver-CrowdSec (LAPI)
// und speist jeden Alert via integrationService.ingest('crowdsec', ...) in dieselbe
// Pipeline wie die Webhook-Quellen (Dedup/Normalize/Queue/Ticket). Mirror von imapPoller.

const { CrowdsecPoller, isEnabled, readConfig } = require('../../src/integrations/adapters/crowdsec/crowdsecPoller');
const { InMemorySettingsRepository } = require('../../src/repositories/InMemorySettingsRepository');
const { saveCrowdsecConnection } = require('../../src/services/crowdsecConnectionSettings');

const ENV_FULL = {
  CROWDSEC_LAPI_URL:   'https://web.example:8080',
  CROWDSEC_MACHINE_ID: 'nexora',
  CROWDSEC_PASSWORD:   'secret',
};

const ALERT_A = { id: 1, scenario: 'crowdsecurity/http-bruteforce', source: { value: '1.2.3.4' } };
const ALERT_B = { id: 2, scenario: 'crowdsecurity/http-probing',    source: { value: '5.6.7.8' } };

// Fake integrationService mit ingest-Spy.
function makeSvc({ failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async ingest(source, payload, opts) {
      calls.push({ source, payload, opts });
      if (failOn && payload.id === failOn) throw new Error('ingest boom');
      return { status: 'accepted' };
    },
  };
}

// Fake LAPI-Client.
function makeClient(alerts) {
  const seen = [];
  return {
    seen,
    async fetchAlerts(opts) { seen.push(opts); return alerts; },
  };
}

describe('crowdsecPoller — Konfig & Aktivierung', () => {
  test('isEnabled: false ohne Pflicht-ENV, true mit', () => {
    expect(isEnabled({})).toBe(false);
    expect(isEnabled({ CROWDSEC_LAPI_URL: 'x' })).toBe(false);
    expect(isEnabled(ENV_FULL)).toBe(true);
  });

  test('readConfig liest URL/Machine/Password + Defaults', () => {
    const c = readConfig(ENV_FULL);
    expect(c.baseUrl).toBe('https://web.example:8080');
    expect(c.machineId).toBe('nexora');
    expect(c.password).toBe('secret');
    expect(typeof c.since).toBe('string');     // Default-Fenster
  });

  test('isEnabled() bleibt der ENV-Hinweis (false ohne ENV)', () => {
    const poller = new CrowdsecPoller(makeSvc(), { env: {} });
    expect(poller.isEnabled()).toBe(false);
  });

  test('start() läuft IMMER (Layer 2: kein Boot-Gate); pollOnce self-skippt ohne Config', async () => {
    const poller = new CrowdsecPoller(makeSvc(), { env: {}, clientFactory: () => { throw new Error('darf nicht gerufen werden'); } });
    expect(poller.start()).toBe(true);        // Loop startet, wartet auf Config
    const res = await poller.pollOnce();       // unkonfiguriert → skip, KEIN clientFactory-Aufruf
    expect(res).toEqual({ processed: 0, failed: 0, skipped: true });
    poller.stop();
  });
});

describe('crowdsecPoller — pollOnce', () => {
  test('speist jeden Alert via ingest("crowdsec", alert) ein', async () => {
    const svc    = makeSvc();
    const poller = new CrowdsecPoller(svc, { env: ENV_FULL, clientFactory: () => makeClient([ALERT_A, ALERT_B]) });

    const res = await poller.pollOnce();

    expect(res).toEqual({ processed: 2, failed: 0 });
    expect(svc.calls.map((c) => c.source)).toEqual(['crowdsec', 'crowdsec']);
    expect(svc.calls.map((c) => c.payload.id)).toEqual([1, 2]);
  });

  test('reicht das since-Fenster an fetchAlerts durch', async () => {
    const client = makeClient([]);
    const poller = new CrowdsecPoller(makeSvc(), { env: { ...ENV_FULL, CROWDSEC_SINCE: '30m' }, clientFactory: () => client });
    await poller.pollOnce();
    expect(client.seen[0]).toEqual({ since: '30m' });
  });

  test('ein fehlerhafter Alert bricht den Lauf NICHT ab (per-Alert gefangen)', async () => {
    const svc    = makeSvc({ failOn: 1 });   // erster Alert wirft
    const poller = new CrowdsecPoller(svc, { env: ENV_FULL, clientFactory: () => makeClient([ALERT_A, ALERT_B]) });

    const res = await poller.pollOnce();

    expect(res).toEqual({ processed: 1, failed: 1 });
    // trotzdem wurde der zweite Alert verarbeitet
    expect(svc.calls.map((c) => c.payload.id)).toEqual([1, 2]);
  });

  test('leeres Alert-Ergebnis → 0/0, kein Fehler', async () => {
    const poller = new CrowdsecPoller(makeSvc(), { env: ENV_FULL, clientFactory: () => makeClient([]) });
    expect(await poller.pollOnce()).toEqual({ processed: 0, failed: 0 });
  });

  test('Layer 2: DB-Config (settingsRepo) gewinnt über ENV — Poller nutzt DB-Verbindung ohne Neustart', async () => {
    const repo = new InMemorySettingsRepository();
    await saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: 'db-machine', password: 'db-pass' });
    const seen = [];
    const poller = new CrowdsecPoller(makeSvc(), {
      env: {},                         // ENV leer → nur DB kann aktivieren
      settingsRepo: repo,
      clientFactory: (cfg) => { seen.push(cfg); return makeClient([ALERT_A]); },
    });
    const res = await poller.pollOnce();
    expect(res).toEqual({ processed: 1, failed: 0 });
    expect(seen[0]).toMatchObject({ baseUrl: 'https://10.0.10.91:8080', machineId: 'db-machine', password: 'db-pass', source: 'db' });
    expect(await poller.isConfigured()).toBe(true);
  });
});
