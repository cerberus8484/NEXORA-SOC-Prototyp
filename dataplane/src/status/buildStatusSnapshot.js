'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Pure: baut aus den Live-Quellen des Dataplane-Knotens (Collector-Hub-Status +
// Intake-/Outbox-Zähler) den Status-Snapshot für die Hub↔Backend-Brücke
// (POST /api/v1/dataplane/status). Normalisiert exakt auf das Backend-Schema:
// kind null→'', unbekannter Status→'pending', Zähler defensiv ≥0. KEINE I/O.
// ─────────────────────────────────────────────────────────────────────────

const VALID_STATES = new Set(['pending', 'running', 'stopped', 'completed', 'failed']);

function intNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function normalizeCollector(c) {
  return {
    name: c && typeof c.name === 'string' ? c.name : '',
    kind: c && c.kind ? String(c.kind) : '',
    status: c && VALID_STATES.has(c.status) ? c.status : 'pending',
    emitted: intNum(c && c.emitted),
    error: c && c.error ? String(c.error) : null,
  };
}

/**
 * @param {{
 *   nodeId: string,
 *   hubStatus?: Array<object>,   // collectorHub.status()
 *   intake?: object,             // { total, accepted, rejected, duplicate, pending }
 *   outbox?: object,             // { pending, processing, completed, retrying, failed, oldestPendingAt }
 *   now?: (() => number)|number
 * }} opts
 */
function buildStatusSnapshot({ nodeId, hubStatus = [], intake = {}, outbox = {}, now = Date.now } = {}) {
  if (!nodeId || typeof nodeId !== 'string') throw new Error('buildStatusSnapshot: nodeId required');
  const ref = typeof now === 'function' ? now() : Number(now);

  const collectors = (Array.isArray(hubStatus) ? hubStatus : [])
    .filter((c) => c && typeof c.name === 'string' && c.name.length > 0)
    .map(normalizeCollector);

  return {
    nodeId,
    reportedAt: new Date(ref).toISOString(),
    collectors,
    intake: {
      total: intNum(intake.total),
      accepted: intNum(intake.accepted),
      rejected: intNum(intake.rejected),
      duplicate: intNum(intake.duplicate),
      pending: intNum(intake.pending),
    },
    outbox: {
      pending: intNum(outbox.pending),
      processing: intNum(outbox.processing),
      completed: intNum(outbox.completed),
      retrying: intNum(outbox.retrying),
      failed: intNum(outbox.failed),
      oldestPendingAt: outbox.oldestPendingAt || null,
    },
  };
}

module.exports = { buildStatusSnapshot };
