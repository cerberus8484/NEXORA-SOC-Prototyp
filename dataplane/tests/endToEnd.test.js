'use strict';

// End-to-End (ohne Docker): Collector → runCollectorPipeline → emit(HTTP) → Intake-Server → persist.
// Beweist die Kombinierbarkeit der Module über den EventEnvelopeV1-Contract.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createIntakeApp } = require('../src/intake/server');
const { createInMemoryIntakeRepo } = require('../src/intake/inMemoryIntakeRepo');
const { runCollectorPipeline } = require('../src/collector/runCollectorPipeline');

const repo = createInMemoryIntakeRepo();
const resolveAuth = (req) =>
  req.get('x-collector-credential') === 'good'
    ? { collectorId: 'col-1', tenantId: 'tenant-a', siteId: 'site-1' }
    : null;

let server; let base;
before(async () => {
  const app = createIntakeApp({ repo, resolveAuth });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const fwCollector = {
  name: 'firewall-opnsense-fw01', domain: 'firewall',
  source: { type: 'firewall', vendor: 'opnsense', instanceId: 'fw-01' }, parserVersion: '1.0.0',
  normalize: (l) => (l.action === 'noise' ? null : {
    observedAt: l.ts, rawHash: 'c'.repeat(64), rawRef: `file://fw/${l.id}`,
    entities: [{ type: 'ip', value: l.src }], confidence: 0.95,
  }),
};

test('Collector emittiert über den Contract in den Intake → persistiert', async () => {
  const items = [
    { id: 1, ts: '2026-06-24T21:00:00.000Z', src: '176.65.139.88', action: 'block' },
    { id: 2, action: 'noise' },                                   // → skip
    { id: 3, ts: '2026-06-24T21:00:01.000Z', src: '91.92.40.10', action: 'pass' },
  ];
  const codes = [];
  const emit = async (env) => {
    const res = await fetch(`${base}/v1/intake/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-collector-credential': 'good' },
      body: JSON.stringify(env),
    });
    codes.push(res.status);
  };
  const stats = await runCollectorPipeline(fwCollector, items, { emit });

  assert.deepStrictEqual(stats, { emitted: 2, skipped: 1, invalid: 0 });
  assert.deepStrictEqual(codes, [202, 202]);   // beide vom Intake akzeptiert
  assert.strictEqual(repo.count(), 2);         // beide persistiert, Tenant aus Auth gesetzt
});
