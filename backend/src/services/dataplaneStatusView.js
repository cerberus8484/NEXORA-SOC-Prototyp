'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Pure Read-Model für die Dataplane-Status-Brücke.
//
// Fasst die gespeicherten Snapshots (je Knoten der letzte) zu einer ehrlichen
// Health-Sicht für die UI zusammen. KEINE I/O, keine Mutation.
//
// fail-honest: ohne frischen Snapshot ist ein Knoten `stale` und zählt NICHT zur
// Verfügbarkeit (`available=false`). Es wird nichts erfunden — ein veralteter
// Heartbeat bleibt sichtbar veraltet.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_STALE_AFTER_MS = 90 * 1000; // 90s — großzügig ~3× ein 30s-Push-Intervall

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function summarizeCollectors(collectors) {
  const list = Array.isArray(collectors) ? collectors : [];
  let running = 0;
  let failed = 0;
  for (const c of list) {
    if (c && c.status === 'running') running += 1;
    if (c && c.status === 'failed') failed += 1;
  }
  return { total: list.length, running, failed };
}

function nodeHealth({ fresh, collectorsSummary, outbox }) {
  if (!fresh) return 'stale';
  if (collectorsSummary.failed > 0 || num(outbox && outbox.failed) > 0) return 'degraded';
  return 'healthy';
}

/**
 * @param {Array<object>} nodes  gespeicherte Snapshots (je nodeId einer)
 * @param {{ staleAfterMs?: number, now?: (() => number)|number }} [opts]
 * @returns {{ available: boolean, staleAfterMs: number, generatedAt: string,
 *             nodes: Array<object>, aggregate: object }}
 */
function summarizeDataplaneStatus(nodes, { staleAfterMs = DEFAULT_STALE_AFTER_MS, now = Date.now } = {}) {
  const list = Array.isArray(nodes) ? nodes : [];
  const ref = typeof now === 'function' ? now() : Number(now);
  const maxAge = Math.max(0, num(staleAfterMs));

  const enriched = list.map((node) => {
    const reportedMs = node && node.reportedAt ? new Date(node.reportedAt).getTime() : NaN;
    const ageMs = Number.isFinite(reportedMs) ? ref - reportedMs : null;
    const fresh = ageMs !== null && ageMs >= 0 && ageMs <= maxAge;
    const collectorsSummary = summarizeCollectors(node && node.collectors);
    const health = nodeHealth({ fresh, collectorsSummary, outbox: node && node.outbox });
    return { ...node, ageMs, fresh, collectorsSummary, health };
  });

  const freshNodes = enriched.filter((n) => n.fresh);
  const sum = (arr, pick) => arr.reduce((acc, x) => acc + num(pick(x)), 0);

  const aggregate = {
    nodes: enriched.length,
    freshNodes: freshNodes.length,
    collectors: sum(enriched, (x) => x.collectorsSummary.total),
    collectorsRunning: sum(enriched, (x) => x.collectorsSummary.running),
    collectorsFailed: sum(enriched, (x) => x.collectorsSummary.failed),
    intake: {
      total: sum(enriched, (x) => x.intake && x.intake.total),
      rejected: sum(enriched, (x) => x.intake && x.intake.rejected),
      pending: sum(enriched, (x) => x.intake && x.intake.pending),
    },
    outbox: {
      pending: sum(enriched, (x) => x.outbox && x.outbox.pending),
      retrying: sum(enriched, (x) => x.outbox && x.outbox.retrying),
      failed: sum(enriched, (x) => x.outbox && x.outbox.failed),
    },
  };

  return {
    available: freshNodes.length > 0,
    staleAfterMs: maxAge,
    generatedAt: new Date(ref).toISOString(),
    nodes: enriched,
    aggregate,
  };
}

module.exports = { summarizeDataplaneStatus, summarizeCollectors, nodeHealth, DEFAULT_STALE_AFTER_MS };
