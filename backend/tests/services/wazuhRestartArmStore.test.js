'use strict';

// Persistenz des Wazuh-Restart-Scharfschalt-Flags.
// Sichert: default false (fail-closed), setArmen/entschärfen persistiert genau
// einen Boolean, nur echtes true gilt als scharf.

const store = require('../../src/services/wazuhRestartArmStore');

// Minimaler In-Memory-Fake des Settings-Repos (nur get/set über die Arm-Key).
function makeFakeRepo() {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    set: async (key, value) => { map.set(key, value); },
    _map: map,
  };
}

describe('wazuhRestartArmStore — Persistenz des Scharfschalt-Flags', () => {
  let fake;
  beforeEach(() => {
    fake = makeFakeRepo();
    store._setRepoForTests(fake);
  });
  afterEach(() => {
    store._setRepoForTests(null);
  });

  test('default: nicht gesetzt → isArmed() false (fail-closed)', async () => {
    expect(await store.isArmed()).toBe(false);
  });

  test('setArmed(true) persistiert true unter dem Arm-Key → isArmed() true', async () => {
    const result = await store.setArmed(true);
    expect(result).toBe(true);
    expect(fake._map.get(store.ARM_KEY)).toBe(true);
    expect(await store.isArmed()).toBe(true);
  });

  test('setArmed(false) entschärft → isArmed() false', async () => {
    await store.setArmed(true);
    const result = await store.setArmed(false);
    expect(result).toBe(false);
    expect(await store.isArmed()).toBe(false);
  });

  test('nur echtes true gilt als scharf (String "true"/1 → false)', async () => {
    fake._map.set(store.ARM_KEY, 'true');
    expect(await store.isArmed()).toBe(false);
    fake._map.set(store.ARM_KEY, 1);
    expect(await store.isArmed()).toBe(false);
  });

  test('setArmed normalisiert truthy Nicht-Booleans auf false (nur true schaltet scharf)', async () => {
    const result = await store.setArmed('yes');
    expect(result).toBe(false);
    expect(fake._map.get(store.ARM_KEY)).toBe(false);
  });
});
