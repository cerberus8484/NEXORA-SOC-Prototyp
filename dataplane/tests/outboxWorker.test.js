'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createOutboxWorker } = require('../src/engine/outboxWorker');
const { createInMemoryOutboxStore } = require('../src/engine/inMemoryOutboxStore');

const T0 = '2026-06-25T12:00:00.000Z';
function env(id, type, vendor, normalized, observedAt = T0) {
  return { outboxId: 'o-' + id, envelope: { eventId: id, observedAt, source: { type, vendor, instanceId: 'i' }, provenance: { confidence: 1 }, normalized } };
}

// Gruppe A: Angreifer↔Asset über drei Domänen (fusioniert zu 1 Vorfall)
const groupA = [
  env('a1', 'ids', 'suricata', { network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10', dstPort: 22, protocol: 'tcp' }, alert: { signature: 'ET SCAN', severity: 1 } }),
  env('a2', 'firewall', 'opnsense', { network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10' }, firewall: { action: 'block' } }),
  env('a3', 'ids', 'conntrack', { network: { srcIp: '198.51.100.10', dstIp: '45.143.200.12', bytesToServer: 1840 } }),
];
// Gruppe B: anderes IP-Paar
const groupB = [env('b1', 'siem', 'wazuh', { network: { srcIp: '8.8.8.8', dstIp: '1.1.1.1' }, detection: { severity: 'medium', signature: 'x' } })];

function collector() { const out = []; const fn = async (inc) => { out.push(inc); }; fn.incidents = out; return fn; }

test('runOnce: fusioniert je Gruppe einen Vorfall, markiert alle Outbox-Einträge completed', async () => {
  const store = createInMemoryOutboxStore([...groupA, ...groupB]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1' });
  const summary = await worker.runOnce();
  assert.strictEqual(summary.claimed, 4);
  assert.strictEqual(summary.incidents, 2);            // 2 IP-Paare
  assert.strictEqual(summary.completed, 4);
  assert.strictEqual(emit.incidents.length, 2);
  const a = emit.incidents.find((i) => i.eventCount === 3);
  assert.strictEqual(a.verdict, 'confirmed_malicious'); // IDS-Alert + Block
  assert.strictEqual(store.countByStatus('completed'), 4);
  assert.strictEqual(store.countByStatus('pending'), 0);
});

test('runOnce: nichts claimbar → kein emit, processed 0', async () => {
  const store = createInMemoryOutboxStore([]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1' });
  const summary = await worker.runOnce();
  assert.strictEqual(summary.claimed, 0);
  assert.strictEqual(emit.incidents.length, 0);
});

test('runOnce: emit wirft → Gruppe retrying mit Backoff (available_at in der Zukunft), nicht completed', async () => {
  const store = createInMemoryOutboxStore([...groupA]);
  const failing = async () => { throw new Error('nexora down'); };
  let nowMs = Date.parse(T0);
  const worker = createOutboxWorker({ store, emit: failing, workerId: 'w1', backoffMs: 1000, now: () => new Date(nowMs).toISOString() });
  const summary = await worker.runOnce();
  assert.strictEqual(summary.completed, 0);
  assert.strictEqual(summary.retried, 3);
  assert.strictEqual(store.countByStatus('retrying'), 3);
  // direkt danach nichts claimbar (available_at in der Zukunft)
  assert.strictEqual((await worker.runOnce()).claimed, 0);
  // nach Ablauf des Backoffs wieder claimbar
  nowMs += 2000;
  assert.strictEqual((await worker.runOnce()).claimed, 3);
});

test('runOnce: emit wirft und maxAttempts erreicht → failed (kein endloses Retry)', async () => {
  const store = createInMemoryOutboxStore([...groupB]); // 1 Eintrag, startet attempt_count 2
  store.setAttemptCount('o-b1', 2);
  const failing = async () => { throw new Error('boom'); };
  const worker = createOutboxWorker({ store, emit: failing, workerId: 'w1', maxAttempts: 3 });
  const summary = await worker.runOnce();
  assert.strictEqual(summary.failed, 1);
  assert.strictEqual(summary.retried, 0);
  assert.strictEqual(store.countByStatus('failed'), 1);
});

test('Window-Re-Fusion: spät geclaimter IDS-Alert fusioniert mit bereits verarbeitetem Block+SIEM → confirmed_malicious', async () => {
  const N = { network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10', dstPort: 22, protocol: 'tcp' } };
  // Block + SIEM-High sind bereits 'completed' (früher eingetroffen, getrennt verarbeitet) ...
  const block = { ...env('w1', 'firewall', 'opnsense', { ...N, firewall: { action: 'block' } }), status: 'completed' };
  const siem = { ...env('w2', 'siem', 'wazuh', { network: N.network, detection: { severity: 'high', signature: 'bf' } }), status: 'completed' };
  // ... der IDS-Alert trifft jetzt NEU ein (pending).
  const alert = env('w3', 'ids', 'suricata', { ...N, alert: { signature: 'ET EXPLOIT', severity: 1 } });
  const store = createInMemoryOutboxStore([block, siem, alert]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1' });

  const summary = await worker.runOnce();
  assert.strictEqual(summary.claimed, 1);              // nur der neue Alert
  assert.strictEqual(emit.incidents.length, 1);
  const inc = emit.incidents[0];
  assert.strictEqual(inc.verdict, 'confirmed_malicious'); // volle Fenstermenge: Alert + Block + SIEM
  assert.strictEqual(inc.eventCount, 3);
  assert.strictEqual(store.countByStatus('completed'), 3); // 2 schon + der neue
});

test('Sliding-Window: Events über eine Bucket-Grenze hinweg fusionieren zu EINEM confirmed_malicious', async () => {
  const N = { network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10' } };
  // Block + SIEM kurz VOR der 12:00-Grenze (bereits verarbeitet) ...
  const block = { ...env('s1', 'firewall', 'opnsense', { ...N, firewall: { action: 'block' } }, '2026-06-25T11:59:58.000Z'), status: 'completed' };
  const siem = { ...env('s2', 'siem', 'wazuh', { network: N.network, detection: { severity: 'high', signature: 'bf' } }, '2026-06-25T11:59:59.000Z'), status: 'completed' };
  // ... IDS-Alert kurz NACH der Grenze (neu, pending) — bei Tumbling-Buckets getrennt.
  const alert = env('s3', 'ids', 'suricata', { ...N, alert: { signature: 'ET EXPLOIT', severity: 1 } }, '2026-06-25T12:00:02.000Z');
  const store = createInMemoryOutboxStore([block, siem, alert]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1' });

  const summary = await worker.runOnce();
  assert.strictEqual(summary.claimed, 1);                 // nur der neue Alert
  assert.strictEqual(emit.incidents.length, 1);
  assert.strictEqual(emit.incidents[0].verdict, 'confirmed_malicious'); // Session über die Grenze
  assert.strictEqual(emit.incidents[0].eventCount, 3);
});

test('failure_reason enthält nur sicheren Code, kein Payload/Stack', async () => {
  const store = createInMemoryOutboxStore([...groupB]);
  const worker = createOutboxWorker({ store, emit: async () => { throw new Error('secret-leak 8.8.8.8'); }, workerId: 'w1' });
  await worker.runOnce();
  const reason = store.get('o-b1').failureReason;
  assert.strictEqual(reason, 'emit_failed');           // fixer Code, nicht die Exception-Message
  assert.ok(!/secret-leak|8\.8\.8\.8/.test(reason));
});

test('Noise-Dedupe: reine ids/info-Telemetrie gegen dasselbe Ziel erzeugt ein Sammel-Incident', async () => {
  const mk = (id, srcIp) => env(id, 'ids', 'suricata', {
    network: { srcIp, dstIp: '31.70.103.246', dstPort: 443, protocol: 'tcp' },
  });
  const store = createInMemoryOutboxStore([
    mk('n1', '45.148.10.121'),
    mk('n2', '179.155.205.132'),
    mk('n3', '104.243.35.120'),
  ]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1' });

  const summary = await worker.runOnce();
  assert.strictEqual(summary.claimed, 3);
  assert.strictEqual(summary.incidents, 1);
  assert.strictEqual(summary.completed, 3);
  assert.strictEqual(emit.incidents[0].verdict, 'observed');
  assert.strictEqual(emit.incidents[0].severity, 'info');
  assert.strictEqual(emit.incidents[0].eventCount, 3);
  assert.match(emit.incidents[0].fusionKey, /^noise:v1:/);
});

test('Noise-Dedupe: spaeteres info-Event nutzt dieselbe Noise-Identity und bleibt idempotent', async () => {
  const first = env('n1', 'ids', 'suricata', {
    network: { srcIp: '45.148.10.121', dstIp: '31.70.103.246', dstPort: 443, protocol: 'tcp' },
  });
  const late = env('n2', 'ids', 'suricata', {
    network: { srcIp: '179.155.205.132', dstIp: '31.70.103.246', dstPort: 443, protocol: 'tcp' },
  }, '2026-06-25T12:04:00.000Z');
  const store = createInMemoryOutboxStore([{ ...first, status: 'completed' }, late]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1' });

  const summary = await worker.runOnce();
  assert.strictEqual(summary.claimed, 1);
  assert.strictEqual(summary.incidents, 1);
  assert.strictEqual(emit.incidents[0].eventCount, 2);
  assert.match(emit.incidents[0].fusionKey, /^noise:v1:/);
});

// ── Attacker-Aggregation (Anti-Flood, attackerAgg=true) ─────────────────────
const FAR = '2026-06-25T18:00:00.000Z'; // 6 h später → bei Tumbling ein anderer Bucket

test('Attacker-Agg AUS (default): zwei Fenster derselben Quell-IP → getrennte incidentIds (bisheriges Verhalten)', async () => {
  const alertEnv = (id, t) => env(id, 'ids', 'suricata', {
    network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10', dstPort: 22, protocol: 'tcp' },
    alert: { signature: 'ET SCAN', severity: 1 },
  }, t);
  const store = createInMemoryOutboxStore([alertEnv('x1', T0), alertEnv('x2', FAR)]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1' }); // attackerAgg default (aus)
  await worker.runOnce();
  assert.strictEqual(emit.incidents.length, 2);
  assert.notStrictEqual(emit.incidents[0].incidentId, emit.incidents[1].incidentId);
});

test('Attacker-Agg AN: dieselbe Quell-IP + Verdikt-Klasse über Fenster hinweg → EINE stabile incidentId', async () => {
  const alertEnv = (id, t) => env(id, 'ids', 'suricata', {
    network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10', dstPort: 22, protocol: 'tcp' },
    alert: { signature: 'ET SCAN', severity: 1 },
  }, t);
  const store = createInMemoryOutboxStore([alertEnv('x1', T0), alertEnv('x2', FAR)]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1', attackerAgg: true });
  await worker.runOnce();
  // Beide Events kollabieren auf EINE Identität (kein Zeit-Bucket).
  assert.strictEqual(emit.incidents.length, 1);
  assert.match(emit.incidents[0].fusionKey, /^attacker:v1:/);
  assert.strictEqual(emit.incidents[0].verdict, 'suspicious');
  assert.strictEqual(emit.incidents[0].eventCount, 2);
});

test('Attacker-Agg AN: verschiedene Quell-IPs → getrennte Vorfälle', async () => {
  const alertEnv = (id, srcIp) => env(id, 'ids', 'suricata', {
    network: { srcIp, dstIp: '198.51.100.10', dstPort: 22, protocol: 'tcp' },
    alert: { signature: 'ET SCAN', severity: 1 },
  });
  const store = createInMemoryOutboxStore([alertEnv('a', '45.143.200.12'), alertEnv('b', '203.0.113.9')]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1', attackerAgg: true });
  await worker.runOnce();
  assert.strictEqual(emit.incidents.length, 2);
  assert.notStrictEqual(emit.incidents[0].incidentId, emit.incidents[1].incidentId);
});

test('Attacker-Agg AN: höhere Verdikt-Klasse derselben IP bleibt eigener Vorfall (Upgrade sichtbar)', async () => {
  const susp = env('s', 'ids', 'suricata', {
    network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10' },
    alert: { signature: 'ET SCAN', severity: 1 },
  });
  const conf = env('c', 'ids', 'suricata', {
    network: { srcIp: '45.143.200.12', dstIp: '198.51.100.10' },
    alert: { signature: 'ET SCAN', severity: 1 }, firewall: { action: 'block' },
  });
  const store = createInMemoryOutboxStore([susp, conf]);
  const emit = collector();
  const worker = createOutboxWorker({ store, emit, workerId: 'w1', attackerAgg: true });
  await worker.runOnce();
  const verdicts = emit.incidents.map((i) => i.verdict).sort();
  assert.deepStrictEqual(verdicts, ['confirmed_malicious', 'suspicious']);
  assert.notStrictEqual(emit.incidents[0].incidentId, emit.incidents[1].incidentId);
});
