'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createCollectorRegistry } = require('../src/collector/collectorRegistry');
const { buildEnvelope } = require('../src/collector/buildEnvelope');
const { runCollectorPipeline } = require('../src/collector/runCollectorPipeline');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');

// Beispiel-Collector (Firewall): rohe Log-Zeile → NormalizedPart; "noise"-Zeilen → null.
const fwCollector = {
  name: 'firewall-opnsense-fw01',
  domain: 'firewall',
  source: { type: 'firewall', vendor: 'opnsense', instanceId: 'fw-01' },
  parserVersion: '1.0.0',
  normalize(line) {
    if (!line || line.action === 'noise') return null;
    return {
      observedAt: line.ts,
      rawHash: 'b'.repeat(64),
      rawRef: `file://fw/${line.id}`,
      entities: [{ type: 'ip', value: line.src }],
      confidence: 0.95,
    };
  },
};

test('Registry: register/get/list/listByDomain/unregister', () => {
  const reg = createCollectorRegistry();
  reg.register(fwCollector);
  assert.strictEqual(reg.count(), 1);
  assert.strictEqual(reg.get('firewall-opnsense-fw01').domain, 'firewall');
  assert.deepStrictEqual(reg.listByDomain('firewall').map((k) => k.name), ['firewall-opnsense-fw01']);
  assert.deepStrictEqual(reg.listByDomain('ids'), []);
  assert.strictEqual(reg.unregister('firewall-opnsense-fw01'), true);
  assert.strictEqual(reg.count(), 0);
});

test('Registry: doppelter Name → Fehler', () => {
  const reg = createCollectorRegistry();
  reg.register(fwCollector);
  assert.throws(() => reg.register(fwCollector), /already registered/);
});

test('Registry: ungültiges Plugin → Fehler', () => {
  const reg = createCollectorRegistry();
  assert.throws(() => reg.register({ name: 'x' }), /domain/);
  assert.throws(() => reg.register({ ...fwCollector, normalize: 'nope' }), /normalize/);
  assert.throws(() => reg.register({ ...fwCollector, source: { type: 'firewall' } }), /source\.vendor/);
});

test('unbegrenzt Collectoren je System (mehrere Instanzen registrierbar)', () => {
  const reg = createCollectorRegistry();
  for (let i = 1; i <= 25; i++) {
    reg.register({ ...fwCollector, name: `firewall-fw${i}`, source: { ...fwCollector.source, instanceId: `fw-${i}` } });
  }
  assert.strictEqual(reg.count(), 25);
  assert.strictEqual(reg.listByDomain('firewall').length, 25);
});

test('buildEnvelope erzeugt contract-konformen Envelope (validateEnvelope grün)', () => {
  const env = buildEnvelope(fwCollector, { observedAt: '2026-06-24T19:05:20.935Z', rawHash: 'b'.repeat(64), rawRef: 'file://x', entities: [{ type: 'ip', value: '203.0.113.5' }], confidence: 0.9 });
  assert.strictEqual(validateEnvelope(env).valid, true);
  assert.deepStrictEqual(env.source, fwCollector.source);
  assert.strictEqual(env.provenance.parserVersion, '1.0.0');
  assert.match(env.eventId, /^[0-9a-f-]{36}$/i); // UUID generiert
});

test('runCollectorPipeline: emittiert nur gültige Envelopes, verwirft Noise', async () => {
  const out = [];
  const items = [
    { id: 1, ts: '2026-06-24T19:00:00.000Z', src: '203.0.113.5', action: 'block' },
    { id: 2, action: 'noise' },                          // → null → skip
    { id: 3, ts: '2026-06-24T19:00:01.000Z', src: '198.51.100.9', action: 'pass' },
  ];
  const stats = await runCollectorPipeline(fwCollector, items, { emit: (e) => out.push(e) });
  assert.deepStrictEqual(stats, { emitted: 2, skipped: 1, invalid: 0 });
  assert.strictEqual(out.length, 2);
  assert.ok(out.every((e) => validateEnvelope(e).valid));
});

test('runCollectorPipeline: konsumiert async-Iterables (Live-Stream stdin/Replay)', async () => {
  async function* stream() {
    yield { id: 1, ts: '2026-06-24T19:00:00.000Z', src: '203.0.113.5', action: 'block' };
    yield { id: 2, action: 'noise' };                    // → null → skip
    yield { id: 3, ts: '2026-06-24T19:00:01.000Z', src: '198.51.100.9', action: 'pass' };
  }
  const out = [];
  const stats = await runCollectorPipeline(fwCollector, stream(), { emit: (e) => out.push(e) });
  assert.deepStrictEqual(stats, { emitted: 2, skipped: 1, invalid: 0 });
  assert.ok(out.every((e) => validateEnvelope(e).valid));
});

test('runCollectorPipeline: normalize-Fehler bricht den Lauf NICHT (invalid gezählt)', async () => {
  const broken = { ...fwCollector, normalize: () => { throw new Error('boom'); } };
  const stats = await runCollectorPipeline(broken, [{ id: 1 }], { emit: () => {} });
  assert.deepStrictEqual(stats, { emitted: 0, skipped: 0, invalid: 1 });
});

test('runCollectorPipeline: ungültige NormalizedPart (fehlt rawHash) → invalid, nicht emittiert', async () => {
  const bad = { ...fwCollector, normalize: () => ({ observedAt: '2026-06-24T19:00:00.000Z', rawRef: 'file://x' }) };
  const out = [];
  const stats = await runCollectorPipeline(bad, [{ id: 1 }], { emit: (e) => out.push(e) });
  assert.strictEqual(stats.invalid, 1);
  assert.strictEqual(out.length, 0);
});
