'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createSuricataCollector } = require('../src/collector/suricataCollector');
const { buildEnvelope } = require('../src/collector/buildEnvelope');
const { validateEnvelope } = require('../src/contract/eventEnvelopeV1');
const { runCollectorPipeline } = require('../src/collector/runCollectorPipeline');

// Echte Suricata eve.json Zeilen (Top-Level-Schema).
const ALERT = JSON.stringify({
  timestamp: '2026-06-24T21:00:00.123456+0000',
  event_type: 'alert',
  src_ip: '45.143.200.12', src_port: 54321,
  dest_ip: '198.51.100.10', dest_port: 22, proto: 'TCP',
  alert: { signature: 'ET SCAN SSH BruteForce', category: 'Attempted Administrator Privilege Gain', severity: 1, signature_id: 2006546, gid: 1 },
  flow: { bytes_toserver: 1840, bytes_toclient: 1450, pkts_toserver: 12, pkts_toclient: 10 },
  community_id: '1:abc', app_proto: 'ssh',
});
const FLOW = JSON.stringify({
  timestamp: '2026-06-24T21:00:05Z', event_type: 'flow',
  src_ip: '45.143.200.12', src_port: 54321, dest_ip: '198.51.100.10', dest_port: 22, proto: 'TCP',
  flow: { bytes_toserver: 500, bytes_toclient: 300, pkts_toserver: 4, pkts_toclient: 3 },
});

test('createSuricataCollector: Identität (domain ids, vendor suricata)', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'] });
  assert.strictEqual(k.domain, 'ids');
  assert.strictEqual(k.source.vendor, 'suricata');
  assert.strictEqual(k.source.instanceId, 'sensor-1');
});

test('createSuricataCollector: assetIps Pflicht', () => {
  assert.throws(() => createSuricataCollector({ instanceId: 's' }), /assetIps/);
  assert.throws(() => createSuricataCollector({ instanceId: 's', assetIps: [] }), /assetIps/);
});

test('normalize alert: 5-Tuple + alert-Block + entities', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'] });
  const part = k.normalize(ALERT);
  assert.strictEqual(part.network.srcIp, '45.143.200.12');
  assert.strictEqual(part.network.dstPort, 22);
  assert.strictEqual(part.network.protocol, 'tcp');
  assert.strictEqual(part.network.bytesToServer, 1840);
  assert.strictEqual(part.alert.signature, 'ET SCAN SSH BruteForce');
  assert.strictEqual(part.alert.signatureId, 2006546);
  assert.strictEqual(part.alert.severity, 1);
  assert.deepStrictEqual(part.entities.map((e) => e.value), ['45.143.200.12', '198.51.100.10']);
  assert.strictEqual(part.observedAt, new Date('2026-06-24T21:00:00.123456+0000').toISOString());
});

test('normalize flow: Bytes ohne alert-Block', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'] });
  const part = k.normalize(FLOW);
  assert.strictEqual(part.network.bytesToClient, 300);
  assert.strictEqual(part.alert, undefined);
});

test('normalize: out-of-scope (kein Asset src/dst) → null', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['10.0.0.1'] });
  assert.strictEqual(k.normalize(ALERT), null);
});

test('normalize: nicht-alert/flow event_type (z.B. stats) → null', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'] });
  assert.strictEqual(k.normalize(JSON.stringify({ event_type: 'stats' })), null);
});

test('normalize: kaputtes JSON → null (kein Throw)', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'] });
  assert.strictEqual(k.normalize('{nope'), null);
});

test('alert → buildEnvelope → contract-konform', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'] });
  const env = buildEnvelope(k, k.normalize(ALERT));
  assert.strictEqual(validateEnvelope(env).valid, true);
  assert.strictEqual(env.source.type, 'ids');
  assert.strictEqual(env.normalized.network.bytesToServer, 1840);
});

test('runCollectorPipeline über eve-Zeilen: nur Scope-Events emittiert', async () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'] });
  const out = [];
  const stats = await runCollectorPipeline(k, [ALERT, FLOW, '{nope', JSON.stringify({ event_type: 'stats' })], { emit: (e) => out.push(e) });
  assert.strictEqual(stats.emitted, 2);
  assert.ok(out.every((e) => validateEnvelope(e).valid));
});

// ── eventTypes-Filter (Anti-Flood, ADR Ticket-Flut) ────────────────────────────
// Honeypot-Suricata emittiert pro beobachteter Verbindung ein flow-Event ohne
// Alert → reines Scan-Rauschen. eventTypes:['alert'] verwirft die Telemetrie.
test('eventTypes ["alert"]: flow-Telemetrie wird verworfen, Alerts bleiben', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'], eventTypes: ['alert'] });
  assert.strictEqual(k.normalize(FLOW), null);
  assert.ok(k.normalize(ALERT), 'Alert muss weiterhin emittiert werden');
});

test('eventTypes default: flow bleibt erhalten (Rückwärtskompatibilität)', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'] });
  assert.ok(k.normalize(FLOW), 'ohne eventTypes-Filter weiterhin flow emittiert');
});

test('eventTypes ["alert"] über Pipeline: flood-flow raus, nur Alert zählt', async () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'], eventTypes: ['alert'] });
  const out = [];
  const stats = await runCollectorPipeline(k, [ALERT, FLOW, FLOW, FLOW], { emit: (e) => out.push(e) });
  assert.strictEqual(stats.emitted, 1, 'nur das Alert-Event, die 3 flow-Events verworfen');
});

test('eventTypes leeres Array: Fallback auf Default (kein Total-Stummschalten)', () => {
  const k = createSuricataCollector({ instanceId: 'sensor-1', assetIps: ['198.51.100.10'], eventTypes: [] });
  assert.ok(k.normalize(ALERT), 'leeres eventTypes darf nicht alles verwerfen');
  assert.ok(k.normalize(FLOW));
});
