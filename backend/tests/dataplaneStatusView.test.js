'use strict';

const { summarizeDataplaneStatus, summarizeCollectors } = require('../src/services/dataplaneStatusView');

const NOW = Date.parse('2026-06-30T12:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function node(over = {}) {
  return {
    nodeId: 'dp-1',
    reportedAt: iso(10_000),
    collectors: [
      { name: 'cowrie', kind: 'siem', status: 'running', emitted: 12, error: null },
      { name: 'suricata', kind: 'ids', status: 'running', emitted: 5, error: null },
    ],
    intake: { total: 100, accepted: 90, rejected: 5, duplicate: 5, pending: 3 },
    outbox: { pending: 2, processing: 1, completed: 80, retrying: 0, failed: 0 },
    ...over,
  };
}

describe('summarizeCollectors', () => {
  test('zählt running und failed', () => {
    const s = summarizeCollectors([
      { status: 'running' }, { status: 'failed' }, { status: 'completed' }, { status: 'running' },
    ]);
    expect(s).toEqual({ total: 4, running: 2, failed: 1 });
  });

  test('robust gegen Nicht-Array', () => {
    expect(summarizeCollectors(null)).toEqual({ total: 0, running: 0, failed: 0 });
  });
});

describe('summarizeDataplaneStatus — Frische & Health', () => {
  test('frischer, fehlerfreier Knoten ist healthy und available', () => {
    const out = summarizeDataplaneStatus([node()], { staleAfterMs: 90_000, now: NOW });
    expect(out.available).toBe(true);
    expect(out.nodes[0].fresh).toBe(true);
    expect(out.nodes[0].health).toBe('healthy');
    expect(out.nodes[0].ageMs).toBe(10_000);
  });

  test('veralteter Snapshot ist stale und NICHT available (fail-honest)', () => {
    const out = summarizeDataplaneStatus([node({ reportedAt: iso(120_000) })], { staleAfterMs: 90_000, now: NOW });
    expect(out.available).toBe(false);
    expect(out.nodes[0].fresh).toBe(false);
    expect(out.nodes[0].health).toBe('stale');
  });

  test('frischer Knoten mit failed Collector ist degraded', () => {
    const out = summarizeDataplaneStatus([node({
      collectors: [{ name: 'x', status: 'failed', error: 'boom' }],
    })], { staleAfterMs: 90_000, now: NOW });
    expect(out.nodes[0].health).toBe('degraded');
    expect(out.nodes[0].collectorsSummary).toEqual({ total: 1, running: 0, failed: 1 });
  });

  test('frischer Knoten mit Outbox-failed > 0 ist degraded', () => {
    const out = summarizeDataplaneStatus([node({ outbox: { failed: 3 } })], { staleAfterMs: 90_000, now: NOW });
    expect(out.nodes[0].health).toBe('degraded');
  });

  test('aggregiert Zähler über mehrere Knoten', () => {
    const out = summarizeDataplaneStatus([node({ nodeId: 'a' }), node({ nodeId: 'b' })], { staleAfterMs: 90_000, now: NOW });
    expect(out.aggregate.nodes).toBe(2);
    expect(out.aggregate.freshNodes).toBe(2);
    expect(out.aggregate.collectors).toBe(4);
    expect(out.aggregate.collectorsRunning).toBe(4);
    expect(out.aggregate.intake.total).toBe(200);
    expect(out.aggregate.outbox.pending).toBe(4);
  });

  test('leere Liste → available=false, keine Knoten', () => {
    const out = summarizeDataplaneStatus([], { now: NOW });
    expect(out.available).toBe(false);
    expect(out.nodes).toEqual([]);
    expect(out.aggregate.nodes).toBe(0);
  });

  test('Zukunfts-Timestamp (negatives Alter) ist nicht fresh', () => {
    const out = summarizeDataplaneStatus([node({ reportedAt: iso(-5_000) })], { staleAfterMs: 90_000, now: NOW });
    expect(out.nodes[0].fresh).toBe(false);
  });
});
