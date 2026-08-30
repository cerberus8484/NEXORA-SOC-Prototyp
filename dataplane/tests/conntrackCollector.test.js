'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseConntrackEvent, createConntrackCollector } = require('../src/collector/conntrackCollector');
const { buildEnvelope } = require('../src/collector/buildEnvelope');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');
const { runCollectorPipeline } = require('../src/collector/runCollectorPipeline');

// Echte conntrack -E -e DESTROY Zeile (acct an): Angreifer → Honeypot :2222.
const LINE = '[DESTROY] tcp      6 src=176.65.139.88 dst=203.0.113.246 sport=54321 dport=2222 packets=12 bytes=1840 src=203.0.113.246 dst=176.65.139.88 sport=2222 dport=54321 packets=10 bytes=1450 [ASSURED]';

test('parseConntrackEvent: orig/reply mit echten Bytes', () => {
  const ev = parseConntrackEvent(LINE);
  assert.strictEqual(ev.proto, 'tcp');
  assert.strictEqual(ev.orig.src, '176.65.139.88');
  assert.strictEqual(ev.orig.dport, 2222);
  assert.strictEqual(ev.orig.bytes, 1840);
  assert.strictEqual(ev.reply.bytes, 1450);
  assert.strictEqual(ev.reply.packets, 10);
});

test('parseConntrackEvent: Nicht-DESTROY / leer → null', () => {
  assert.strictEqual(parseConntrackEvent('[NEW] tcp 6 src=1.2.3.4 dst=5.6.7.8'), null);
  assert.strictEqual(parseConntrackEvent(''), null);
  assert.strictEqual(parseConntrackEvent(null), null);
});

test('normalize: echte Bytes toServer/toClient + 5-Tuple', () => {
  const k = createConntrackCollector({ instanceId: 'vps-hp', ports: [22, 2222] });
  const part = k.normalize(LINE);
  assert.strictEqual(part.network.bytesToServer, 1840);
  assert.strictEqual(part.network.bytesToClient, 1450);
  assert.strictEqual(part.network.pktsToServer, 12);
  assert.strictEqual(part.network.dstPort, 2222);
  assert.deepStrictEqual(part.entities.map((e) => e.value), ['176.65.139.88', '203.0.113.246']);
});

test('normalize: Port außerhalb Scope → null (eigener Egress wird verworfen)', () => {
  const k = createConntrackCollector({ instanceId: 'vps-hp', ports: [22, 2222] });
  // VPS-Egress zu DNS :53 — kein Scope-Port → verworfen
  const egress = '[DESTROY] udp 17 src=203.0.113.246 dst=10.99.99.10 sport=40000 dport=53 packets=2 bytes=120 src=10.99.99.10 dst=203.0.113.246 sport=53 dport=40000 packets=2 bytes=300';
  assert.strictEqual(k.normalize(egress), null);
});

test('normalize: leere Ports = alle Flows behalten', () => {
  const k = createConntrackCollector({ instanceId: 'vps-hp' });
  assert.notStrictEqual(k.normalize(LINE), null);
});

test('conntrack-Part → buildEnvelope → contract-konform (mit normalized.network)', () => {
  const k = createConntrackCollector({ instanceId: 'vps-hp', ports: [2222] });
  const env = buildEnvelope(k, k.normalize(LINE), { observedAt: '2026-06-24T21:00:00.000Z' });
  assert.strictEqual(validateEnvelope(env).valid, true);
  assert.strictEqual(env.normalized.network.bytesToServer, 1840);
  assert.deepStrictEqual(env.source, { type: 'flow', vendor: 'conntrack', instanceId: 'vps-hp' });
});

test('runCollectorPipeline über conntrack-Zeilen: emittiert nur Scope-Flows', async () => {
  const k = createConntrackCollector({ instanceId: 'vps-hp', ports: [22, 2222] });
  const lines = [
    LINE,                                                                                   // :2222 → emit
    '[NEW] tcp 6 src=1.2.3.4 dst=203.0.113.246 sport=1 dport=2222',                          // NEW → skip
    '[DESTROY] udp 17 src=203.0.113.246 dst=10.99.99.10 sport=40000 dport=53 packets=2 bytes=120', // egress → skip
  ];
  const out = [];
  const stats = await runCollectorPipeline(k, lines, { emit: (e) => out.push(e) });
  assert.strictEqual(stats.emitted, 1);
  assert.strictEqual(out.length, 1);
  assert.ok(validateEnvelope(out[0]).valid);
  assert.strictEqual(out[0].normalized.network.bytesToClient, 1450);
});
