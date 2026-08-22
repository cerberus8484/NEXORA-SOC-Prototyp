'use strict';

// Deployment Center — First-Boot-Drive deliver-Strategie.
// Baut aus der gerenderten config.xml ein Media-Artefakt und hängt es über die
// Connector-Op attachConfigMedia an die laufende VM. Fehler bubbeln (retryable
// → der Applier wiederholt; hart → der Orchestrator rollt zurück).

const { makeFirstBootDriveDeliver } = require('../../src/deploy/appliers/firstBootDriveDeliver');

const XML = '<opnsense><system><hostname>fw-lab</hostname></system></opnsense>';
const HASH = 'b'.repeat(64);

function fakeBuilder() {
  return {
    build: jest.fn(({ xml, configHash, label }) => ({
      filename: 'opnsense-config-bbbbbbbbbbbb.xml',
      guestPath: '/conf/config.xml',
      content: xml,
      configHash,
      label: label || 'OPNSENSE_CFG',
    })),
  };
}

function fakeConnector(attachImpl) {
  return {
    id: 'fake',
    attachConfigMedia: jest.fn(attachImpl || (async () => ({ mediaRef: 'local:snippets/opnsense-config-bbbbbbbbbbbb.xml' }))),
  };
}

describe('makeFirstBootDriveDeliver — Konstruktion', () => {
  test('ohne mediaBuilder wirft', () => {
    expect(() => makeFirstBootDriveDeliver({})).toThrow(/mediaBuilder/);
  });
});

describe('firstBootDriveDeliver — Zustellung', () => {
  test('baut Media und hängt sie an die VM (attachConfigMedia)', async () => {
    const builder = fakeBuilder();
    const connector = fakeConnector();
    const deliver = makeFirstBootDriveDeliver({ mediaBuilder: builder });

    const res = await deliver({ connector, vmid: 1234, xml: XML, configHash: HASH, params: { hostname: 'fw-lab' } });

    expect(builder.build).toHaveBeenCalledTimes(1);
    expect(connector.attachConfigMedia).toHaveBeenCalledTimes(1);
    const [vmidArg, mediaArg] = connector.attachConfigMedia.mock.calls[0];
    expect(vmidArg).toBe(1234);
    expect(mediaArg.content).toBe(XML);
    expect(mediaArg.configHash).toBe(HASH);
    expect(res.applied).toBe(true);
    expect(res.channel).toBe('first-boot-drive');
    expect(res.mediaRef).toMatch(/opnsense-config/);
  });

  test('fail-safe: Connector ohne attachConfigMedia → wirft nicht-retrybar', async () => {
    const deliver = makeFirstBootDriveDeliver({ mediaBuilder: fakeBuilder() });
    await expect(deliver({ connector: { id: 'no-media' }, vmid: 1, xml: XML, configHash: HASH, params: {} }))
      .rejects.toMatchObject({ retryable: false });
  });

  test('retryable Connector-Fehler bubbelt (Applier wiederholt)', async () => {
    const err = new Error('guest agent not ready'); err.retryable = true;
    const connector = fakeConnector(async () => { throw err; });
    const deliver = makeFirstBootDriveDeliver({ mediaBuilder: fakeBuilder() });
    await expect(deliver({ connector, vmid: 1, xml: XML, configHash: HASH, params: {} }))
      .rejects.toMatchObject({ retryable: true });
  });

  test('harter Builder-Fehler bubbelt (Orchestrator rollt zurück)', async () => {
    const builder = { build: jest.fn(() => { throw new Error('media build kaputt'); }) };
    const deliver = makeFirstBootDriveDeliver({ mediaBuilder: builder });
    await expect(deliver({ connector: fakeConnector(), vmid: 1, xml: XML, configHash: HASH, params: {} }))
      .rejects.toThrow(/media build/);
  });
});
