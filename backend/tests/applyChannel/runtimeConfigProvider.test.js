'use strict';

// P_CORR_ADMIN_2 Stufe 2 — RuntimeConfigProvider: liest den AKTIVEN Wert je Capability
// aus dem Store, fällt fail-safe auf den Default zurück. Wird vom Worker an Job-Grenzen
// gelesen (laufende Jobs behalten ihren Snapshot).

const { RuntimeConfigProvider } = require('../../src/applyChannel/RuntimeConfigProvider');
const { InMemoryApplyRepository } = require('../../src/applyChannel/InMemoryApplyRepository');

let repo; let provider;
beforeEach(() => {
  repo = new InMemoryApplyRepository();
  provider = new RuntimeConfigProvider({ applyRepo: repo });
});

test('leerer Store → Default (Fallback)', async () => {
  expect(await provider.getMaxChildren(200)).toBe(200);
  expect(await provider.getMaxRetries(3)).toBe(3);
});

test('aktiver Store-Wert wird gelesen', async () => {
  await repo.writeRuntimeConfig({ capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 350 }, appliedBy: 'a' });
  expect(await provider.getMaxChildren(200)).toBe(350);
});

test('neueste aktive Version gewinnt', async () => {
  await repo.writeRuntimeConfig({ capabilityId: 'correlator.worker.maxRetries', targetId: 'correlation-worker', value: { maxRetries: 5 }, appliedBy: 'a' });
  await repo.writeRuntimeConfig({ capabilityId: 'correlator.worker.maxRetries', targetId: 'correlation-worker', value: { maxRetries: 7 }, appliedBy: 'a' });
  expect(await provider.getMaxRetries(3)).toBe(7);
});

test('Repo-Fehler → fail-safe Default (kein Crash)', async () => {
  const brokenProvider = new RuntimeConfigProvider({ applyRepo: { getActiveRuntimeConfig: async () => { throw new Error('db down'); } } });
  expect(await brokenProvider.getMaxChildren(200)).toBe(200);
});

test('unsinniger gespeicherter Wert → Default', async () => {
  await repo.writeRuntimeConfig({ capabilityId: 'correlator.worker.maxChildren', targetId: 'correlation-worker', value: { maxChildren: 'nope' }, appliedBy: 'a' });
  expect(await provider.getMaxChildren(200)).toBe(200);
});
