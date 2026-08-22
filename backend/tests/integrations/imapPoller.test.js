'use strict';

// ── Tests für den IMAP-Poller (E-Mail → ingest('email') Pipeline) ────────────
// Injizierter clientFactory + Fake-integrationService → kein echter IMAP-Server.

const { ImapPoller, isEnabled, readConfig } = require('../../src/integrations/adapters/email/imapPoller');

const FULL_ENV = { IMAP_HOST: 'mail.example', IMAP_USER: 'soc@example', IMAP_PASSWORD: 'pw' };

function makeMessage(over = {}) {
  return {
    envelope: {
      from:      [{ address: 'attacker@evil.test' }],
      to:        [{ address: 'soc@example' }],
      subject:   'Phishing report',
      messageId: '<abc@evil.test>',
      date:      '2026-06-20T10:00:00.000Z',
      ...(over.envelope || {}),
    },
    source: Buffer.from(over.body || 'verdächtige Mail'),
  };
}

function makeClient({ uids = [], messages = {} } = {}) {
  const calls = { connect: 0, logout: 0, released: 0, flagged: [] };
  return {
    _calls: calls,
    connect: async () => { calls.connect += 1; },
    getMailboxLock: async () => ({ release: () => { calls.released += 1; } }),
    search: async () => uids,
    fetchOne: async (uid) => (Object.prototype.hasOwnProperty.call(messages, uid) ? messages[uid] : null),
    messageFlagsAdd: async (uid) => { calls.flagged.push(uid); },
    logout: async () => { calls.logout += 1; },
  };
}

function makeSvc({ failOn = null } = {}) {
  const ingested = [];
  return {
    _ingested: ingested,
    ingest: async (source, payload, meta) => {
      if (failOn && payload.messageId === failOn) throw new Error('ingest boom');
      ingested.push({ source, payload, meta });
      return { accepted: true };
    },
  };
}

describe('readConfig', () => {
  test('liest ENV mit Defaults (Port 993, secure true)', () => {
    const c = readConfig(FULL_ENV);
    expect(c).toEqual({ host: 'mail.example', port: 993, user: 'soc@example', password: 'pw', secure: true });
  });

  test('IMAP_TLS=false → secure false; IMAP_PORT übernommen', () => {
    const c = readConfig({ ...FULL_ENV, IMAP_TLS: 'false', IMAP_PORT: '143' });
    expect(c.secure).toBe(false);
    expect(c.port).toBe(143);
  });
});

describe('isEnabled', () => {
  test('true nur wenn host + user + password gesetzt', () => {
    expect(isEnabled(FULL_ENV)).toBe(true);
    expect(isEnabled({ IMAP_HOST: 'h', IMAP_USER: 'u' })).toBe(false);
    expect(isEnabled({})).toBe(false);
  });
});

describe('ImapPoller Konstruktion / start', () => {
  test('wirft ohne integrationService', () => {
    expect(() => new ImapPoller(null, { env: FULL_ENV })).toThrow('integrationService');
  });

  test('start() startet den Loop IMMER (Layer 2: kein ENV-Gate) und liefert true', () => {
    const poller = new ImapPoller(makeSvc(), { env: {}, clientFactory: () => makeClient() });
    expect(poller.isEnabled()).toBe(false);   // ENV-Hinweis: unkonfiguriert
    expect(poller.start()).toBe(true);        // Loop läuft trotzdem (pollOnce self-skippt)
    poller.stop();
  });
});

describe('ImapPoller Hot-Reload (DB > ENV)', () => {
  test('pollOnce self-skippt ohne Konfiguration — kein clientFactory-Aufruf, kein Netzwerk', async () => {
    let built = 0;
    const poller = new ImapPoller(makeSvc(), { env: {}, clientFactory: () => { built += 1; return makeClient(); } });
    const res = await poller.pollOnce();
    expect(res).toEqual({ processed: 0, failed: 0, skipped: true });
    expect(built).toBe(0);
  });

  test('settingsRepo (DB) hat Vorrang vor ENV — Poller nutzt die DB-Verbindung', async () => {
    const { InMemorySettingsRepository } = require('../../src/repositories/InMemorySettingsRepository');
    const { saveImapConnection } = require('../../src/services/imapConnectionSettings');
    const repo = new InMemorySettingsRepository();
    await saveImapConnection(repo, { host: 'db.mail', user: 'db@x', password: 'db-pass' });

    let seen = null;
    const svc    = makeSvc();
    const client = makeClient({ uids: [1], messages: { 1: makeMessage() } });
    const poller = new ImapPoller(svc, { env: {}, settingsRepo: repo, clientFactory: (cfg) => { seen = cfg; return client; } });

    const res = await poller.pollOnce();

    expect(res).toEqual({ processed: 1, failed: 0 });
    expect(seen).toMatchObject({ host: 'db.mail', user: 'db@x', password: 'db-pass', source: 'db' });
  });
});

describe('ImapPoller.pollOnce', () => {
  test('speist jede ungelesene Mail in ingest(email) ein und markiert sie \\Seen', async () => {
    const svc = makeSvc();
    const client = makeClient({ uids: [1, 2], messages: { 1: makeMessage(), 2: makeMessage({ envelope: { messageId: '<two@x>' } }) } });
    const poller = new ImapPoller(svc, { env: FULL_ENV, clientFactory: () => client });

    const res = await poller.pollOnce();

    expect(res).toEqual({ processed: 2, failed: 0 });
    expect(svc._ingested).toHaveLength(2);
    expect(svc._ingested[0].source).toBe('email');
    expect(svc._ingested[0].meta).toEqual({ ip: 'imap' });
    expect(svc._ingested[0].payload.from).toBe('attacker@evil.test');
    expect(svc._ingested[0].payload.subject).toBe('Phishing report');
    expect(client._calls.flagged).toEqual(['1', '2']); // beide als gelesen markiert
    expect(client._calls.logout).toBe(1);
    expect(client._calls.released).toBe(1);
  });

  test('fehlgeschlagene Mail (ingest wirft) bleibt UNGELESEN, Lauf bricht nicht ab', async () => {
    const svc = makeSvc({ failOn: '<boom@x>' });
    const client = makeClient({ uids: [1, 2], messages: { 1: makeMessage({ envelope: { messageId: '<boom@x>' } }), 2: makeMessage({ envelope: { messageId: '<ok@x>' } }) } });
    const poller = new ImapPoller(svc, { env: FULL_ENV, clientFactory: () => client });

    const res = await poller.pollOnce();

    expect(res).toEqual({ processed: 1, failed: 1 });
    expect(client._calls.flagged).toEqual(['2']); // nur die erfolgreiche Mail markiert
    expect(client._calls.logout).toBe(1);          // Logout trotzdem
  });

  test('leeres fetchOne → failed++ ohne Markierung', async () => {
    const svc = makeSvc();
    const client = makeClient({ uids: [9], messages: {} }); // uid 9 liefert null
    const poller = new ImapPoller(svc, { env: FULL_ENV, clientFactory: () => client });

    const res = await poller.pollOnce();

    expect(res).toEqual({ processed: 0, failed: 1 });
    expect(client._calls.flagged).toEqual([]);
    expect(svc._ingested).toHaveLength(0);
  });

  test('_toPayload mappt fehlende Envelope-Felder robust', async () => {
    const svc = makeSvc();
    const client = makeClient({ uids: [1], messages: { 1: { envelope: {}, source: Buffer.from('x') } } });
    const poller = new ImapPoller(svc, { env: FULL_ENV, clientFactory: () => client });

    await poller.pollOnce();

    const p = svc._ingested[0].payload;
    expect(p.from).toBe('');
    expect(p.to).toBe('');
    expect(p.subject).toBe('');
    expect(typeof p.receivedAt).toBe('string'); // Fallback auf jetzt
  });
});
