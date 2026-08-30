'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { runCollector } = require('../src/collector/collectorRuntime');
const { createConntrackCollector } = require('../src/collector/conntrackCollector');

const LINE = '[DESTROY] tcp 6 src=45.143.200.12 dst=198.51.100.10 sport=54321 dport=2222 packets=12 bytes=1840 src=198.51.100.10 dst=45.143.200.12 sport=2222 dport=54321 packets=10 bytes=1450';
const EGRESS = '[DESTROY] udp 17 src=198.51.100.10 dst=192.0.2.53 sport=40000 dport=53 packets=2 bytes=120';

function fakeFetch(status = 202) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { status, ok: status < 300 }; };
  fn.calls = calls;
  return fn;
}

test('runCollector: emittiert Scope-Events an den Intake (Fake-Fetch), Zähler stimmen', async () => {
  const k = createConntrackCollector({ instanceId: 'test-hp', ports: [2222] });
  const f = fakeFetch(202);
  const { stats, counters } = await runCollector({
    collector: k,
    source: [LINE, EGRESS],
    env: { INTAKE_URL: 'http://intake/v1/intake/events', COLLECTOR_CREDENTIAL: 'tok' },
    fetchImpl: f,
  });
  assert.strictEqual(stats.emitted, 1);   // EGRESS :53 out of scope
  assert.strictEqual(stats.skipped, 1);
  assert.strictEqual(counters.emitted, 1);
  assert.strictEqual(counters.errors, 0);
  assert.strictEqual(f.calls.length, 1);
  assert.strictEqual(f.calls[0].opts.headers['x-collector-credential'], 'tok');
});

test('runCollector: Intake-Rejection (z.B. 400) zählt errors hoch, bricht NICHT ab', async () => {
  const k = createConntrackCollector({ instanceId: 'test-hp', ports: [2222] });
  const f = fakeFetch(400);
  const { counters } = await runCollector({
    collector: k,
    source: [LINE, LINE],
    env: { INTAKE_URL: 'http://intake', COLLECTOR_CREDENTIAL: 'tok' },
    fetchImpl: f,
  });
  assert.strictEqual(counters.errors, 2);
  assert.strictEqual(f.calls.length, 2); // beide versucht trotz Fehler
});
