'use strict';

const { randomUUID } = require('crypto');
const { pool, query } = require('../db/pool');
const { boundLimit, emptyStatusCounts, SUPERSEDED_PREFIX } = require('./correlationReadQuerySupport');

/**
 * PostgresCorrelationRepository — persistente Correlation-Jobs + -Results (P_CORR_1a).
 * Gleicher öffentlicher Vertrag wie InMemoryCorrelationRepository (Parität).
 *
 * Idempotenz: der Partial-Unique-Index `uq_correlation_jobs_active_input` lässt nur EINEN
 * aktiven Job je input_hash zu. Ein Konflikt-Insert wirft 23505 → hier als
 * `ACTIVE_INPUT_CONFLICT` (mit dem bestehenden Job) normalisiert.
 */

const UNIQUE_VIOLATION = '23505';

function activeInputConflict(existing) {
  const err = new Error('correlation_job_active_input_conflict');
  err.code = 'ACTIVE_INPUT_CONFLICT';
  err.existing = existing;
  return err;
}

function isoOrNull(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : v;
}

class PostgresCorrelationRepository {
  constructor({ queryFn = query, poolRef = pool } = {}) {
    this._query = queryFn;
    this._pool = poolRef;
  }

  _rowToJob(r) {
    if (!r) return null;
    return {
      id: r.id, ticketId: r.ticket_id, inputHash: r.input_hash,
      sourceRevision: r.source_revision, engineVersion: r.engine_version,
      status: r.status, retryCount: r.retry_count, failureReason: r.failure_reason,
      resultReference: r.result_reference,
      createdAt: isoOrNull(r.created_at), startedAt: isoOrNull(r.started_at), completedAt: isoOrNull(r.completed_at),
    };
  }

  _rowToResult(r, evidenceRefs = []) {
    if (!r) return null;
    return {
      id: r.id, ticketId: r.ticket_id, jobId: r.job_id, inputHash: r.input_hash,
      sourceRevision: r.source_revision, engineVersion: r.engine_version,
      result: typeof r.result === 'string' ? JSON.parse(r.result) : r.result,
      evidenceRefs,
      createdAt: isoOrNull(r.created_at),
    };
  }

  async createJob(job) {
    try {
      const res = await this._query(`
        INSERT INTO correlation_jobs
          (id, ticket_id, input_hash, source_revision, engine_version, status, retry_count, failure_reason, result_reference, created_at, started_at, completed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *`,
        [job.id, job.ticketId, job.inputHash, job.sourceRevision, job.engineVersion, job.status,
         job.retryCount ?? 0, job.failureReason ?? null, job.resultReference ?? null,
         job.createdAt, job.startedAt ?? null, job.completedAt ?? null]);
      return this._rowToJob(res.rows[0]);
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        const existing = await this.findActiveJobByInputHash(job.inputHash);
        throw activeInputConflict(existing);
      }
      throw err;
    }
  }

  async findJobById(id) {
    const res = await this._query('SELECT * FROM correlation_jobs WHERE id = $1', [id]);
    return this._rowToJob(res.rows[0]);
  }

  // Reconcile/Recovery: noch nicht erledigte Jobs (pending|retrying), älteste zuerst, bounded.
  async findSchedulableJobs({ limit = 100 } = {}) {
    const max = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const res = await this._query(
      `SELECT * FROM correlation_jobs WHERE status IN ('pending','retrying') ORDER BY created_at ASC LIMIT $1`,
      [max]);
    return res.rows.map((r) => this._rowToJob(r));
  }

  async findActiveJobByInputHash(inputHash) {
    const res = await this._query(
      `SELECT * FROM correlation_jobs
       WHERE input_hash = $1 AND status IN ('pending','running','retrying')
       ORDER BY created_at DESC LIMIT 1`, [inputHash]);
    return this._rowToJob(res.rows[0]);
  }

  async updateJob(job) {
    const res = await this._query(`
      UPDATE correlation_jobs SET
        status = $2, retry_count = $3, failure_reason = $4, result_reference = $5,
        started_at = $6, completed_at = $7
      WHERE id = $1 RETURNING *`,
      [job.id, job.status, job.retryCount ?? 0, job.failureReason ?? null,
       job.resultReference ?? null, job.startedAt ?? null, job.completedAt ?? null]);
    return this._rowToJob(res.rows[0]);
  }

  // Atomar: Result + alle Evidence-Rückverweise in EINER Transaktion (kein Teil-Result).
  async saveResult(result) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO correlation_results
          (id, ticket_id, job_id, input_hash, source_revision, engine_version, result, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [result.id, result.ticketId, result.jobId ?? null, result.inputHash,
         result.sourceRevision, result.engineVersion, JSON.stringify(result.result ?? null), result.createdAt]);

      const refs = result.evidenceRefs || [];
      if (refs.length > 0) {
        const values = [];
        const params = [];
        let p = 1;
        for (const ref of refs) {
          values.push(`($${p++},$${p++},$${p++},$${p++},$${p++})`);
          params.push(randomUUID(), result.id, ref.ticketId, ref.role, ref.evidenceId ?? null);
        }
        await client.query(
          `INSERT INTO correlation_result_evidence (id, result_id, ticket_id, role, evidence_id) VALUES ${values.join(',')}`,
          params);
      }
      await client.query('COMMIT');
      return { ...result, evidenceRefs: [...refs] };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async _loadEvidence(resultId) {
    const res = await this._query(
      'SELECT ticket_id, role, evidence_id FROM correlation_result_evidence WHERE result_id = $1', [resultId]);
    return res.rows.map((r) => ({ ticketId: r.ticket_id, role: r.role, evidenceId: r.evidence_id }));
  }

  async findResultById(id) {
    const res = await this._query('SELECT * FROM correlation_results WHERE id = $1', [id]);
    if (!res.rows[0]) return null;
    return this._rowToResult(res.rows[0], await this._loadEvidence(id));
  }

  async findResultByInputHash(inputHash) {
    const res = await this._query(
      'SELECT * FROM correlation_results WHERE input_hash = $1 ORDER BY created_at DESC LIMIT 1', [inputHash]);
    if (!res.rows[0]) return null;
    return this._rowToResult(res.rows[0], await this._loadEvidence(res.rows[0].id));
  }

  async findLatestResultByTicket(ticketId) {
    const res = await this._query(
      'SELECT * FROM correlation_results WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1', [ticketId]);
    if (!res.rows[0]) return null;
    return this._rowToResult(res.rows[0], await this._loadEvidence(res.rows[0].id));
  }

  // ── Read-only Registry-Queries (P_CORR_ADMIN_1) — kein Schreibpfad ──────────

  /** Jobs (optional nach Status), newest first, bounded + parametrisiert. */
  async listJobs({ status = null, limit = undefined, offset = 0 } = {}) {
    const max = boundLimit(limit);
    const off = Math.max(0, Number(offset) || 0);
    if (status) {
      const res = await this._query(
        `SELECT * FROM correlation_jobs WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [status, max, off]);
      return res.rows.map((r) => this._rowToJob(r));
    }
    const res = await this._query(
      `SELECT * FROM correlation_jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [max, off]);
    return res.rows.map((r) => this._rowToJob(r));
  }

  /** Status-Verteilung über alle Jobs; fehlende Status werden zu 0 normalisiert. */
  async countJobsByStatus() {
    const res = await this._query('SELECT status, COUNT(*)::int AS count FROM correlation_jobs GROUP BY status', []);
    const counts = emptyStatusCounts();
    for (const r of res.rows) counts[r.status] = Number(r.count) || 0;
    return counts;
  }

  /** Anzahl der „durch neuere Revision ersetzt"-Jobs (failed + superseded-Prefix). */
  async countSupersededJobs() {
    const res = await this._query(
      `SELECT COUNT(*)::int AS count FROM correlation_jobs WHERE status = 'failed' AND failure_reason LIKE $1`,
      [`${SUPERSEDED_PREFIX}%`]);
    return Number(res.rows[0] && res.rows[0].count) || 0;
  }

  /** Results newest first, bounded. Summary-Listing: Evidence-Refs werden hier NICHT
   *  pro Zeile nachgeladen (N+1-Vermeidung) — Detail über findResultById. */
  async listResults({ limit = undefined, offset = 0 } = {}) {
    const max = boundLimit(limit);
    const off = Math.max(0, Number(offset) || 0);
    const res = await this._query(
      `SELECT * FROM correlation_results ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [max, off]);
    return res.rows.map((r) => this._rowToResult(r, []));
  }
}

module.exports = { PostgresCorrelationRepository };
