'use strict';

// Persistenz des Deploy-Scharfschalt-Flags (Zwei-Schlüssel, Betriebs-Ebene).
// Der env-Boden DEPLOY_ENABLED ist die Kommissionierung (out-of-band); DIESER Store
// ist der Alltags-Toggle darüber. Wie der Wazuh-Arm-Store: fail-closed default,
// genau ein Boolean, geteilte platform_settings-Tabelle (keine neue Migration).

const store = require('../../src/services/deployArmStore');

function makeFakeRepo() {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    set: async (key, value) => { map.set(key, value); },
    _map: map,
  };
}

describe('deployArmStore — Persistenz des Deploy-Scharfschalt-Flags', () => {
  let fake;
  beforeEach(() => { fake = makeFakeRepo(); store._setRepoForTests(fake); });
  afterEach(() => { store._setRepoForTests(null); });

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
    expect(await store.setArmed(false)).toBe(false);
    expect(await store.isArmed()).toBe(false);
  });

  test('nur echtes true gilt als scharf (truthy-Werte zählen nicht)', async () => {
    await fake.set(store.ARM_KEY, 'true');   // String, nicht Boolean
    expect(await store.isArmed()).toBe(false);
  });

  test('setArmed normalisiert nicht-boolean auf false (idempotent, fail-closed)', async () => {
    expect(await store.setArmed('ja')).toBe(false);
    expect(fake._map.get(store.ARM_KEY)).toBe(false);
  });
});
