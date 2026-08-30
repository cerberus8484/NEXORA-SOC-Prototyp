'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_1 — reine Präsentationslogik für Correlator-Jobs/-Results/-Queue.
//
// Zwei Aufgaben: (1) `superseded` aus (failed + Worker-Prefix) ableiten, damit es
// als „durch neuere Ticket-Revision ersetzt" erklärt wird statt als Fehler;
// (2) nur SICHERE Zusammenfassungen ausgeben — kein Roh-Result-Payload, kein
// Stack, keine unnötigen Evidence-Inhalte, keine Secrets.
//
// Rein (keine DB, kein HTTP) → voll unit-testbar.
// ─────────────────────────────────────────────────────────────────────────

const { isSupersededJob } = require('../repositories/correlationReadQuerySupport');

const PRESENTATION_STATUS = Object.freeze({
  PENDING: 'pending', RUNNING: 'running', RETRYING: 'retrying',
  COMPLETED: 'completed', FAILED: 'failed', SUPERSEDED: 'superseded',
});

const ACTIVE = new Set([PRESENTATION_STATUS.PENDING, PRESENTATION_STATUS.RUNNING, PRESENTATION_STATUS.RETRYING]);

// Sanitierung: nur druckbare Zeichen, eine Zeile, gedeckelte Länge — kein Stack/DB-Inhalt.
const SAFE_PATTERN = /[^\w\s\-äöüÄÖÜß.,;:!?()[\]/→]/gu;
const MAX_REASON_LEN = 160;
function sanitizeReason(reason) {
  if (!reason || typeof reason !== 'string') return null;
  const oneLine = reason.replace(/\s+/g, ' ').trim();
  const safe = oneLine.replace(SAFE_PATTERN, '').trim();
  if (!safe) return null;
  return safe.length > MAX_REASON_LEN ? `${safe.slice(0, MAX_REASON_LEN - 1)}…` : safe;
}

/** Leitet die Präsentationsklasse ab: failed+Prefix → superseded, sonst DB-Status. */
function presentationStatusOf(job) {
  if (isSupersededJob(job)) return PRESENTATION_STATUS.SUPERSEDED;
  return job && job.status;
}

/**
 * Sichere Job-Zusammenfassung — nur Status, Zeiten, Engine-Version, Ticket-/Trace-
 * Referenzen + redigierte Fehlerzusammenfassung. KEIN failureReason-Rohfeld.
 */
function toJobSummary(job) {
  if (!job) return null;
  const superseded = isSupersededJob(job);
  return {
    id: job.id,
    ticketId: job.ticketId,
    presentationStatus: presentationStatusOf(job),
    superseded,
    engineVersion: job.engineVersion,
    sourceRevision: job.sourceRevision,
    inputHash: job.inputHash,           // Traceability-Referenz (Idempotenz-Schlüssel)
    resultReference: job.resultReference || null,
    retryCount: job.retryCount || 0,
    // Bei superseded keine Fehler-Anzeige (es ist kein Fehler); sonst redigiert.
    failureSummary: superseded ? null : sanitizeReason(job.failureReason),
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
  };
}

// Korrelations-Meta sicher aus result.result.correlation ziehen (wie Frontend extractCorrMeta).
function extractMeta(payload) {
  if (!payload || typeof payload !== 'object') return { eventCount: 0, sources: [] };
  const corr = payload.correlation;
  if (!corr || typeof corr !== 'object') return { eventCount: 0, sources: [] };
  const eventCount = typeof corr.eventCount === 'number' ? corr.eventCount : 0;
  const sources = Array.isArray(corr.sources)
    ? corr.sources
      .filter((s) => s && typeof s === 'object' && 'source' in s && 'count' in s)
      .map((s) => ({ source: String(s.source), count: Number(s.count) || 0 }))
    : [];
  return { eventCount, sources };
}

/**
 * Sichere Result-Zusammenfassung — Meta + Trace-Referenzen, NIE das rohe Payload.
 */
function toResultSummary(result) {
  if (!result) return null;
  const meta = extractMeta(result.result);
  return {
    id: result.id,
    ticketId: result.ticketId,
    jobId: result.jobId || null,
    inputHash: result.inputHash,
    sourceRevision: result.sourceRevision,
    engineVersion: result.engineVersion,
    eventCount: meta.eventCount,
    sources: meta.sources,
    evidenceRefCount: Array.isArray(result.evidenceRefs) ? result.evidenceRefs.length : 0,
    createdAt: result.createdAt || null,
  };
}

/**
 * Queue-/Health-Zusammenfassung aus DB-Status-Zählern + abgeleitetem superseded.
 * `failed` zeigt nur ECHTE Fehler (db-failed minus superseded).
 */
function summarizeQueue({ counts = {}, supersededCount = 0 } = {}) {
  const pending = counts.pending || 0;
  const running = counts.running || 0;
  const retrying = counts.retrying || 0;
  const completed = counts.completed || 0;
  const dbFailed = counts.failed || 0;
  const superseded = Math.max(0, Number(supersededCount) || 0);
  const genuineFailed = Math.max(0, dbFailed - superseded);
  return {
    total: pending + running + retrying + completed + dbFailed,
    active: pending + running + retrying,
    pending, running, retrying, completed,
    failed: genuineFailed,
    superseded,
  };
}

module.exports = {
  PRESENTATION_STATUS, ACTIVE,
  presentationStatusOf, sanitizeReason, toJobSummary, toResultSummary, summarizeQueue,
};
