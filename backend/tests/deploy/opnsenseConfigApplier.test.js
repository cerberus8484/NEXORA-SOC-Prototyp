'use strict';

// Deployment Center — Phase 5: OPNsense config-Applier.
// Rendert die config.xml und liefert sie über einen injizierten deliver-Kanal
// in die laufende VM: idempotent (stabiler configHash), Retry bei „Agent noch
// nicht bereit", harter Fehler → wirft (Orchestrator rollt zurück).

const { makeOpnsenseConfigApplier } = require('../../src/deploy/appliers/opnsenseConfigApplier');

function params(overrides = {}) {
  return {
    hostname: 'fw-lab', ipMode: 'static', staticIp: '10.0.10.1', cidr: 24, gateway: '10.0.10.254',
    vlanTag: 10, dns: ['10.0.10.10'], wanInterface: 'vtnet0', lanInterface: 'vtnet1', ...overrides,
  };
}

const connector = { id: 'fake' };

describe('opnsenseConfigApplier — Rendering + Delivery', () => {
  test('rendert die config.xml und übergibt sie an deliver', async () => {
    const deliver = jest.fn().mockResolvedValue({ applied: true });
    const applier = makeOpnsenseConfigApplier({ deliver, delayMs: 0 });
    await applier(connector, 1234, params());
    expect(deliver).toHaveBeenCalledTimes(1);
    const arg = deliver.mock.calls[0][0];
    expect(arg.vmid).toBe(1234);
    expect(arg.xml).toMatch(/<hostname>fw-lab<\/hostname>/);
    expect(arg.configHash).toBeTruthy();
  });

  test('gleiche Params → gleicher configHash (Idempotenz-Basis)', async () => {
    const hashes = [];
    const deliver = jest.fn().mockImplementation(async ({ configHash }) => { hashes.push(configHash); return { applied: true }; });
    const applier = makeOpnsenseConfigApplier({ deliver, delayMs: 0 });
    await applier(connector, 1234, params());
    await applier(connector, 1234, params());
    expect(hashes[0]).toBe(hashes[1]);
  });
});

describe('opnsenseConfigApplier — Retry + Fehler', () => {
  test('Retry, wenn der VM-Agent noch nicht bereit ist', async () => {
    let n = 0;
    const deliver = jest.fn().mockImplementation(async () => {
      n += 1;
      if (n < 2) { const e = new Error('guest agent not ready'); e.retryable = true; throw e; }
      return { applied: true };
    });
    const applier = makeOpnsenseConfigApplier({ deliver, delayMs: 0, maxAttempts: 5 });
    await applier(connector, 1234, params());
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  test('persistenter Fehler → wirft (Orchestrator rollt zurück)', async () => {
    const deliver = jest.fn().mockRejectedValue(new Error('config-import hart fehlgeschlagen'));
    const applier = makeOpnsenseConfigApplier({ deliver, delayMs: 0, maxAttempts: 3 });
    await expect(applier(connector, 1234, params())).rejects.toThrow(/config-import/i);
  });

  test('Default-Applier ohne konfigurierten deliver ist fail-safe (wirft, kein stiller Erfolg)', async () => {
    const { opnsenseConfigApplier } = require('../../src/deploy/appliers/opnsenseConfigApplier');
    await expect(opnsenseConfigApplier(connector, 1234, params())).rejects.toThrow();
  });
});
