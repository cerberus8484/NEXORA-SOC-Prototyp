'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gatherDbCounts } = require('../src/status/gatherDbCounts');
const { buildStatusReporterFromEnv } = require('../src/status/statusReporter');

// SQL-basierter Fake-Pool (robust gegen Aufrufreihenfolge / nebenläufige Ticks).
// Reihenfolge der Checks: oldest-Query VOR intake_outbox prüfen (Substring-Overlap).
function sqlPool({ intake = [], outbox = [], oldest = [] } = {}) {
  return {
    async query(sql) {
      if (sql.includes('intake_events')) return { rows: intake };
      if (sql.includes('min(available_at)')) return { rows: oldest };
      if (sql.includes('intake_outbox')) return { rows: outbox };
      return { rows: [] };
    },
  };
}

test('gatherDbCounts faltet Intake-/Outbox-Status zu Zählern', async () => {
  const pool = sqlPool({
    intake: [{ status: 'accepted', n: 90 }, { status: 'rejected', n: 5 }, { status: 'pending', n: 3 }],
    outbox: [{ status: 'completed', n: 80 }, { status: 'pending', n: 2 }, { status: 'failed', n: 1 }],
    oldest: [{ oldest: '2026-06-30T11:58:00.000Z' }],
  });

  const out = await gatherDbCounts(pool);
  assert.equal(out.intake.total, 98);
  assert.equal(out.intake.accepted, 90);
  assert.equal(out.intake.rejected, 5);
  assert.equal(out.intake.duplicate, 0); // nicht gemeldet → 0
  assert.equal(out.outbox.completed, 80);
  assert.equal(out.outbox.failed, 1);
  assert.equal(out.outbox.oldestPendingAt, '2026-06-30T11:58:00.000Z');
});

test('gatherDbCounts wirft ohne brauchbaren Pool', async () => {
  await assert.rejects(() => gatherDbCounts(null), /pool.query required/);
});

test('buildStatusReporterFromEnv ist AUS ohne URL/Secret', () => {
  const hub = { status: () => [] };
  assert.equal(buildStatusReporterFromEnv({ hub, env: {} }), null);
  assert.equal(buildStatusReporterFromEnv({ hub, env: { NEXORA_STATUS_URL: 'http://x' } }), null);
});

test('buildStatusReporterFromEnv baut Reporter + sendet Hub-Status (ohne DB)', async () => {
  const sent = [];
  const hub = { status: () => [{ name: 'cowrie', kind: 'siem', status: 'running', emitted: 4, error: null }] };
  const reporter = buildStatusReporterFromEnv({
    hub,
    env: { NEXORA_STATUS_URL: 'http://nexora/api/v1/dataplane/status', WEBHOOK_SECRET_DATAPLANE: 's', NEXORA_NODE_ID: 'dp-1' },
    makeSender: () => async (snap) => { sent.push(snap); },
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
  });
  assert.ok(reporter);
  await reporter.tick();
  reporter.stop();

  const last = sent[sent.length - 1];
  assert.equal(last.nodeId, 'dp-1');
  assert.equal(last.collectors[0].name, 'cowrie');
  assert.equal(last.intake.total, 0); // keine DB → Default
});

test('buildStatusReporterFromEnv mischt echte DB-Zähler ein, wenn DATAPLANE_DB_URL gesetzt', async () => {
  const sent = [];
  const hub = { status: () => [] };
  const pool = sqlPool({ intake: [{ status: 'accepted', n: 10 }], outbox: [{ status: 'pending', n: 4 }], oldest: [{ oldest: null }] });
  const reporter = buildStatusReporterFromEnv({
    hub,
    env: { NEXORA_STATUS_URL: 'http://x', WEBHOOK_SECRET_DATAPLANE: 's', DATAPLANE_DB_URL: 'postgres://x', NEXORA_NODE_ID: 'dp-1' },
    makeSender: () => async (snap) => { sent.push(snap); },
    makePool: () => pool,
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
  });
  await reporter.tick();
  reporter.stop();

  const last = sent[sent.length - 1];
  assert.equal(last.intake.total, 10);
  assert.equal(last.outbox.pending, 4);
});
