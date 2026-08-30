'use strict';

// Deployment Center — deliver-Kanal-Auswahl (DEPLOY_DELIVER_CHANNEL).
// Default (unset/none/unbekannt) → fail-safe: der deliver wirft, NIE stiller
// Erfolg. Nur ein explizit konfigurierter Kanal + vorhandener mediaBuilder
// liefert eine echte Zustellung.

const { makeDeliverChannel, resolveDeliverFromEnv } = require('../../src/deploy/appliers/deliverChannelFactory');

const XML = '<opnsense/>';
const HASH = 'c'.repeat(64);

function fakeBuilder() {
  return { build: jest.fn(({ xml, configHash }) => ({ filename: 'cfg.xml', guestPath: '/conf/config.xml', content: xml, configHash, label: 'X' })) };
}
function fakeConnector() {
  return { attachConfigMedia: jest.fn(async () => ({ mediaRef: 'local:snippets/cfg.xml' })) };
}

describe('makeDeliverChannel — Auswahl', () => {
  test('unbekannter Kanal → fail-safe (wirft)', async () => {
    const deliver = makeDeliverChannel({ channel: 'zauberei', mediaBuilder: fakeBuilder() });
    await expect(deliver({ connector: fakeConnector(), vmid: 1, xml: XML, configHash: HASH, params: {} })).rejects.toThrow();
  });

  test('leerer/none Kanal → fail-safe (wirft)', async () => {
    for (const channel of ['', 'none', undefined]) {
      const deliver = makeDeliverChannel({ channel, mediaBuilder: fakeBuilder() });
      // eslint-disable-next-line no-await-in-loop
      await expect(deliver({ connector: fakeConnector(), vmid: 1, xml: XML, configHash: HASH, params: {} })).rejects.toThrow();
    }
  });

  test('first-boot-drive OHNE mediaBuilder → fail-safe (wirft, kein stiller Erfolg)', async () => {
    const deliver = makeDeliverChannel({ channel: 'first-boot-drive', mediaBuilder: null });
    await expect(deliver({ connector: fakeConnector(), vmid: 1, xml: XML, configHash: HASH, params: {} })).rejects.toThrow();
  });

  test('first-boot-drive MIT mediaBuilder → echte Zustellung', async () => {
    const connector = fakeConnector();
    const deliver = makeDeliverChannel({ channel: 'first-boot-drive', mediaBuilder: fakeBuilder() });
    const res = await deliver({ connector, vmid: 7, xml: XML, configHash: HASH, params: { hostname: 'fw' } });
    expect(res.applied).toBe(true);
    expect(connector.attachConfigMedia).toHaveBeenCalledTimes(1);
  });
});

describe('resolveDeliverFromEnv — ENV-Gate', () => {
  const OLD = process.env.DEPLOY_DELIVER_CHANNEL;
  afterEach(() => { if (OLD === undefined) delete process.env.DEPLOY_DELIVER_CHANNEL; else process.env.DEPLOY_DELIVER_CHANNEL = OLD; });

  test('ENV unset → fail-safe deliver', async () => {
    delete process.env.DEPLOY_DELIVER_CHANNEL;
    const deliver = resolveDeliverFromEnv({ mediaBuilder: fakeBuilder() });
    await expect(deliver({ connector: fakeConnector(), vmid: 1, xml: XML, configHash: HASH, params: {} })).rejects.toThrow();
  });

  test('ENV=first-boot-drive + mediaBuilder → echte Zustellung', async () => {
    process.env.DEPLOY_DELIVER_CHANNEL = 'first-boot-drive';
    const connector = fakeConnector();
    const deliver = resolveDeliverFromEnv({ mediaBuilder: fakeBuilder() });
    const res = await deliver({ connector, vmid: 1, xml: XML, configHash: HASH, params: {} });
    expect(res.applied).toBe(true);
  });
});
