'use strict';

// Ehrliche Intake-/Outbox-Zähler aus der Dataplane-DB (für den Status-Snapshot).
// Pool injiziert → testbar ohne echte DB. Best-effort: der Aufrufer fängt Fehler
// (Status ist Beiwerk, kein Vorfall). KEINE Schreibzugriffe.

const INTAKE_KEYS = ['accepted', 'rejected', 'duplicate', 'pending'];
const OUTBOX_KEYS = ['pending', 'processing', 'completed', 'retrying', 'failed'];

function foldCounts(rows, keys) {
  const out = {};
  for (const k of keys) out[k] = 0;
  let total = 0;
  for (const r of rows || []) {
    const n = Number(r.n) || 0;
    total += n;
    if (Object.prototype.hasOwnProperty.call(out, r.status)) out[r.status] = n;
  }
  return { out, total };
}

/**
 * @param {{ query:(sql:string)=>Promise<{rows:Array}> }} pool
 * @returns {Promise<{intake:object, outbox:object}>}
 */
async function gatherDbCounts(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('gatherDbCounts: pool.query required');

  const intakeRows = (await pool.query('SELECT status, count(*)::int AS n FROM intake_events GROUP BY status')).rows;
  const outboxRows = (await pool.query('SELECT status, count(*)::int AS n FROM intake_outbox GROUP BY status')).rows;
  const oldest = (await pool.query(
    "SELECT min(available_at) AS oldest FROM intake_outbox WHERE status IN ('pending','retrying')",
  )).rows[0];

  const intake = foldCounts(intakeRows, INTAKE_KEYS);
  const outbox = foldCounts(outboxRows, OUTBOX_KEYS);
  const oldestPendingAt = oldest && oldest.oldest
    ? (oldest.oldest instanceof Date ? oldest.oldest.toISOString() : oldest.oldest)
    : null;

  return {
    intake: { total: intake.total, ...intake.out },
    outbox: { ...outbox.out, oldestPendingAt },
  };
}

module.exports = { gatherDbCounts };
