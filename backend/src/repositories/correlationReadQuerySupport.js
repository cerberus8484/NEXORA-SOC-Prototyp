'use strict';

// P_CORR_ADMIN_1 — geteilte Helfer für die read-only Registry-Queries beider
// Correlation-Repos (Parität InMemory ↔ Postgres). Reines Lesen, bounded Limits.

const { CORRELATION_STATUS } = require('../correlation/correlationJobDomain');

const READ_DEFAULT_LIMIT = 50;
const READ_MAX_LIMIT = 200; // kein unbounded Listing

// Read-side Vertrag: der CorrelationWorker beendet einen Job, dessen Eingabe-
// Revision sich während der Berechnung änderte, als `failed` mit genau diesem
// Prefix in failureReason (CorrelationWorker.js). Wir LESEN das nur, um daraus
// die Präsentationsklasse `superseded` abzuleiten — der Worker wird NICHT geändert.
const SUPERSEDED_PREFIX = 'superseded:';

/** True, wenn ein (failed-)Job in Wahrheit „durch neuere Revision ersetzt" ist. */
function isSupersededJob(job) {
  return !!job
    && job.status === 'failed'
    && typeof job.failureReason === 'string'
    && job.failureReason.startsWith(SUPERSEDED_PREFIX);
}

/** Klemmt ein Limit in [1, READ_MAX_LIMIT]; ungültige Eingabe → Default. */
function boundLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return READ_DEFAULT_LIMIT;
  return Math.min(Math.floor(n), READ_MAX_LIMIT);
}

/** Vollständige Status-Verteilung mit allen bekannten Status auf 0. */
function emptyStatusCounts() {
  const out = {};
  for (const s of Object.values(CORRELATION_STATUS)) out[s] = 0;
  return out;
}

module.exports = {
  READ_DEFAULT_LIMIT, READ_MAX_LIMIT, SUPERSEDED_PREFIX,
  boundLimit, emptyStatusCounts, isSupersededJob,
};
