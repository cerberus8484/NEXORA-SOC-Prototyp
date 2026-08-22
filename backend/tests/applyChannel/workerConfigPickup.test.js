'use strict';

// P_CORR_ADMIN_2 Stufe 2 — Worker liest maxChildren/maxRetries an Job-Grenzen aus
// dem Runtime-Config-Store (über den Provider). Ohne Provider: Verhalten unverändert.

const { CorrelationWorker } = require('../../src/correlation/CorrelationWorker');

function fakeQueue() { return { registerWorker: async () => {} }; }

test('ohne configProvider → Konstruktor-Default an der Job-Grenze (unverändert)', async () => {
  const w = new CorrelationWorker({ repo: {}, queue: fakeQueue(), engine: { correlate() {} }, tickets: {}, maxChildren: 200, maxRetries: 3 });
  expect(await w._maxChildrenForJob()).toBe(200);
  expect(await w._maxRetriesForJob()).toBe(3);
});

test('mit configProvider → angewendeter Store-Wert an der Job-Grenze', async () => {
  const provider = { getMaxChildren: async () => 350, getMaxRetries: async () => 5 };
  const w = new CorrelationWorker({ repo: {}, queue: fakeQueue(), engine: { correlate() {} }, tickets: {}, maxChildren: 200, maxRetries: 3, configProvider: provider });
  expect(await w._maxChildrenForJob()).toBe(350);
  expect(await w._maxRetriesForJob()).toBe(5);
});

test('Provider liefert Unsinn → fail-safe auf Konstruktor-Default', async () => {
  const provider = { getMaxChildren: async () => NaN, getMaxRetries: async () => 0 };
  const w = new CorrelationWorker({ repo: {}, queue: fakeQueue(), engine: { correlate() {} }, tickets: {}, maxChildren: 200, maxRetries: 3, configProvider: provider });
  expect(await w._maxChildrenForJob()).toBe(200);
  expect(await w._maxRetriesForJob()).toBe(3);
});
