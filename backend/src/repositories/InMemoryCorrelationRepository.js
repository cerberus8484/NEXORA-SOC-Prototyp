'use strict';

/**
 * InMemoryCorrelationRepository — Dev/Test-Persistenz für Correlation-Jobs + -Results.
 * Gleicher öffentlicher Vertrag wie PostgresCorrelationRepository (Parität).
 *
 * Idempotenz: höchstens EIN aktiver Job je inputHash (spiegelt den Postgres-Partial-
 * Unique-Index). createJob wirft bei Konflikt `ACTIVE_INPUT_CONFLICT` (Race-Backstop).
 */

const { READ_DEFAULT_LIMIT, boundLimit, emptyStatusCounts, isSupersededJob } = require('./correlationReadQuerySupport');

const ACTIVE_STATES = new Set(['pending', 'running', 'retrying']);

function activeInputConflict(existing) {
  const err = new Error('correlation_job_active_input_conflict');
  err.code = 'ACTIVE_INPUT_CONFLICT';
  err.existing = existing;
  return err;
}

class InMemoryCorrelationRepository {
  constructor() {
    this._jobs    = new Map(); // id → jobJson
    this._results = new Map(); // id → resultJson (evidenceRefs inline)
  }

  async createJob(job) {
    const active = await this.findActiveJobByInputHash(job.inputHash);
    if (active && active.id !== job.id) throw activeInputConflict(active);
    this._jobs.set(job.id, { ...job });
    return { ...job };
  }

  async findJobById(id) {
    const j = this._jobs.get(id);
    return j ? { ...j } : null;
  }

  async findActiveJobByInputHash(inputHash) {
    for (const j of this._jobs.values()) {
      if (j.inputHash === inputHash && ACTIVE_STATES.has(j.status)) return { ...j };
    }
    return null;
  }

  async updateJob(job) {
    if (!this._jobs.has(job.id)) return null;
    this._jobs.set(job.id, { ...job });
    return { ...job };
  }

  // Reconcile/Recovery: noch nicht erledigte Jobs (pending|retrying), älteste zuerst, bounded.
  async findSchedulableJobs({ limit = 100 } = {}) {
    const max = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const out = [];
    for (const j of this._jobs.values()) {
      if (j.status === 'pending' || j.status === 'retrying') out.push({ ...j });
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return out.slice(0, max);
  }

  async saveResult(result) {
    const stored = { ...result, evidenceRefs: [...(result.evidenceRefs || [])] };
    this._results.set(result.id, stored);
    return { ...stored, evidenceRefs: [...stored.evidenceRefs] };
  }

  async findResultById(id) {
    const r = this._results.get(id);
    return r ? { ...r, evidenceRefs: [...r.evidenceRefs] } : null;
  }

  async findResultByInputHash(inputHash) {
    return this._latest((r) => r.inputHash === inputHash);
  }

  async findLatestResultByTicket(ticketId) {
    return this._latest((r) => r.ticketId === ticketId);
  }

  _latest(predicate) {
    let best = null;
    for (const r of this._results.values()) {
      if (predicate(r) && (!best || r.createdAt > best.createdAt)) best = r;
    }
    return best ? { ...best, evidenceRefs: [...best.evidenceRefs] } : null;
  }

  // ── Read-only Registry-Queries (P_CORR_ADMIN_1) — kein Schreibpfad ──────────

  /** Jobs (optional nach Status), newest first, bounded. Reines Lesen. */
  async listJobs({ status = null, limit = READ_DEFAULT_LIMIT, offset = 0 } = {}) {
    const max = boundLimit(limit);
    const off = Math.max(0, Number(offset) || 0);
    let arr = [...this._jobs.values()];
    if (status) arr = arr.filter((j) => j.status === status);
    arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)); // DESC
    return arr.slice(off, off + max).map((j) => ({ ...j }));
  }

  /** Status-Verteilung über ALLE Jobs (vollständig, fehlende Status = 0). */
  async countJobsByStatus() {
    const counts = emptyStatusCounts();
    for (const j of this._jobs.values()) {
      counts[j.status] = (counts[j.status] || 0) + 1;
    }
    return counts;
  }

  /** Anzahl der „durch neuere Revision ersetzt"-Jobs (failed + superseded-Prefix). */
  async countSupersededJobs() {
    let n = 0;
    for (const j of this._jobs.values()) if (isSupersededJob(j)) n++;
    return n;
  }

  /** Results newest first, bounded (Evidence-Refs inline). */
  async listResults({ limit = READ_DEFAULT_LIMIT, offset = 0 } = {}) {
    const max = boundLimit(limit);
    const off = Math.max(0, Number(offset) || 0);
    const arr = [...this._results.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return arr.slice(off, off + max).map((r) => ({ ...r, evidenceRefs: [...(r.evidenceRefs || [])] }));
  }

  // Test-Helfer
  clear() { this._jobs.clear(); this._results.clear(); }
}

module.exports = { InMemoryCorrelationRepository, ACTIVE_STATES };
