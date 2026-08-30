'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildStatusSnapshot } = require('../src/status/buildStatusSnapshot');
const { createStatusSender, startStatusReporter } = require('../src/status/statusReporter');

const NOW = Date.parse('2026-06-30T12:00:00.000Z');

test('buildStatusSnapshot normalisiert Hub-Status auf das Backend-Schema', () => {
  const snap = buildStatusSnapshot({
    nodeId: 'dp-1',
    hubStatus: [
      { name: 'cowrie', kind: 'siem', status: 'running', emitted: 7, error: null, stats: {} },
      { name: 'suricata', kind: null, status: 'failed', emitted: -3, error: 'boom' }, // kind null, negativ
      { name: '', status: 'running' }, // ohne Name → fällt raus
    ],
    intake: { total: 50, rejected: 2 },
    outbox: { pending: 1, failed: 0 },
    now: () => NOW,
  });

  assert.equal(snap.nodeId, 'dp-1');
  assert.equal(snap.reportedAt, '2026-06-30T12:00:00.000Z');
  assert.equal(snap.collectors.length, 2); // namenloser entfernt
  assert.deepEqual(snap.collectors[0], { name: 'cowrie', kind: 'siem', status: 'running', emitted: 7, error: null });
  assert.equal(snap.collectors[1].kind, ''); // null → ''
  assert.equal(snap.collectors[1].emitted, 0); // negativ → 0
  assert.equal(snap.intake.total, 50);
  assert.equal(snap.intake.duplicate, 0); // Default
  assert.equal(snap.outbox.pending, 1);
  assert.equal(snap.outbox.oldestPendingAt, null);
});

test('buildStatusSnapshot wirft ohne nodeId', () => {
  assert.throws(() => buildStatusSnapshot({ hubStatus: [] }), /nodeId required/);
});

test('createStatusSender signiert und postet, akzeptiert 202', async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { status: 202 }; };
  const send = createStatusSender({ url: 'http://nexora/api/v1/dataplane/status', secret: 's3cr3t', fetchImpl: fakeFetch });

  await send({ nodeId: 'dp-1' });
  assert.equal(captured.url, 'http://nexora/api/v1/dataplane/status');
  assert.equal(captured.opts.method, 'POST');
  assert.match(captured.opts.headers['x-webhook-signature'], /^sha256=[0-9a-f]{64}$/);
  assert.ok(captured.opts.headers['x-webhook-timestamp']);
});

test('createStatusSender wirft bei HTTP 500 (fail → Retry beim nächsten Tick)', async () => {
  const send = createStatusSender({ url: 'http://x', secret: 's', fetchImpl: async () => ({ status: 500 }) });
  await assert.rejects(() => send({}), /HTTP 500/);
});

test('startStatusReporter baut Snapshot aus gather() und sendet ihn', async () => {
  const sent = [];
  const reporter = startStatusReporter({
    nodeId: 'dp-1',
    gather: () => ({ hubStatus: [{ name: 'c', status: 'running', emitted: 1 }], intake: { total: 9 }, outbox: {} }),
    send: async (snap) => { sent.push(snap); },
    now: () => NOW,
    setIntervalImpl: () => ({ unref() {} }), // kein echter Timer
    clearIntervalImpl: () => {},
  });

  await reporter.tick(); // deterministisch (zusätzlich zum sofortigen Auto-Tick)
  reporter.stop();

  const last = sent[sent.length - 1];
  assert.equal(last.nodeId, 'dp-1');
  assert.equal(last.collectors[0].name, 'c');
  assert.equal(last.intake.total, 9);
});

test('startStatusReporter ist fail-soft: gather-Fehler kippt nicht, geht an onError', async () => {
  const errors = [];
  const reporter = startStatusReporter({
    nodeId: 'dp-1',
    gather: () => { throw new Error('gather kaputt'); },
    send: async () => {},
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
    onError: (e) => errors.push(e),
  });

  await reporter.tick();
  reporter.stop();
  assert.ok(errors.some((e) => /gather kaputt/.test(e.message)));
});
