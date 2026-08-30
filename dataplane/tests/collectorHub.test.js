'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createCollectorHub } = require('../src/collector/collectorHub');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');
const { createPollSource } = require('../src/collector/pullSource');

// Minimaler, gültiger Collector: jedes Nicht-null-Item → contract-konforme NormalizedPart.
function passCollector(name) {
  return {
    name, domain: 'siem', source: { type: 'siem', vendor: 'test', instanceId: name }, parserVersion: '0.1.0',
    normalize: (item) => (item == null ? null : {
      observedAt: '2026-06-24T21:00:00.000Z',
      rawHash: 'a'.repeat(64), rawRef: `t:${name}`,
      entities: [{ type: 'ip', value: '198.51.100.5', role: 'source' }],
      confidence: 1,
    }),
  };
}

test('Hub fährt mehrere Collectoren nebenläufig, gemeinsamer Emitter, Status je Collector', async () => {
  const emitted = [];
  const specs = [
    { name: 'a', items: [1, 2] },
    { name: 'b', items: [3] },
  ];
  const hub = createCollectorHub({
    specs,
    makeCollector: (s) => passCollector(s.name),
    makeSource: (s) => s.items,
    emit: async (env) => { emitted.push(env); },
  });
  hub.start();
  await hub.wait();

  assert.strictEqual(emitted.length, 3);
  assert.ok(emitted.every((e) => validateEnvelope(e).valid));
  const st = Object.fromEntries(hub.status().map((s) => [s.name, s]));
  assert.strictEqual(st.a.emitted, 2);
  assert.strictEqual(st.b.emitted, 1);
  assert.strictEqual(st.a.status, 'completed');
  assert.strictEqual(st.b.status, 'completed');
});

test('Eindeutige Namen erzwungen (Duplikat → Fehler)', () => {
  assert.throws(() => createCollectorHub({
    specs: [{ name: 'x' }, { name: 'x' }],
    makeCollector: () => passCollector('x'), makeSource: () => [], emit: () => {},
  }), /eindeutig|duplicate|x/i);
});

test('Isolation: fällt eine Quelle aus, laufen die anderen weiter', async () => {
  const emitted = [];
  const hub = createCollectorHub({
    specs: [{ name: 'bad' }, { name: 'good', items: [1, 2] }],
    makeCollector: (s) => passCollector(s.name),
    makeSource: (s) => { if (s.name === 'bad') throw new Error('source unreachable'); return s.items; },
    emit: async (env) => { emitted.push(env); },
    onError: () => {},
  });
  hub.start();
  await hub.wait();

  const st = Object.fromEntries(hub.status().map((s) => [s.name, s]));
  assert.strictEqual(st.bad.status, 'failed');
  assert.strictEqual(st.good.status, 'completed');
  assert.strictEqual(st.good.emitted, 2);   // good läuft trotz bad
  assert.strictEqual(emitted.length, 2);
});

test('AbortSignal stoppt einen kontinuierlichen Pull-Collector sauber', async () => {
  const ctrl = new AbortController();
  let n = 0;
  const fetchSince = async () => { n += 1; if (n === 3) ctrl.abort(); return { records: [{}], cursor: null }; };
  const hub = createCollectorHub({
    specs: [{ name: 'stream' }],
    makeCollector: (s) => passCollector(s.name),
    makeSource: (s, { signal }) => createPollSource({ fetchSince, intervalMs: 1, wait: async () => {}, signal }),
    emit: async () => {},
  });
  hub.start({ signal: ctrl.signal });
  await hub.wait();
  const st = hub.status()[0];
  assert.ok(['stopped', 'completed'].includes(st.status));
  assert.ok(st.emitted >= 1);
});

test('Leere spec-Liste ist gültig (no-op)', async () => {
  const hub = createCollectorHub({ specs: [], makeCollector: () => {}, makeSource: () => [], emit: () => {} });
  hub.start();
  await hub.wait();
  assert.deepStrictEqual(hub.status(), []);
});

test('Pflicht-Factories fehlen → Fehler', () => {
  assert.throws(() => createCollectorHub({ specs: [], makeSource: () => [], emit: () => {} }), /makeCollector/);
  assert.throws(() => createCollectorHub({ specs: [], makeCollector: () => {}, emit: () => {} }), /makeSource/);
  assert.throws(() => createCollectorHub({ specs: [], makeCollector: () => {}, makeSource: () => [] }), /emit/);
});
