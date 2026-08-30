'use strict';

// P_CORR_ADMIN_2 Stufe 3 — PostgresWorkerStatusRepository. Gleicher Vertrag wie
// InMemory. adopted_config_versions wird per jsonb-Merge (||) zusammengeführt.

const { query } = require('../db/pool');

function iso(v) { return v instanceof Date ? v.toISOString() : v; }

class PostgresWorkerStatusRepository {
  constructor({ queryFn = query } = {}) { this._query = queryFn; }

  _row(r) {
    if (!r) return null;
    return {
      workerId: r.worker_id,
      lastHeartbeatAt: iso(r.last_heartbeat_at),
      adoptedConfigVersions: r.adopted_config_versions || {},
      lastJobStartedAt: iso(r.last_job_started_at),
      lastJobCompletedAt: iso(r.last_job_completed_at),
      lastJobOutcome: r.last_job_outcome,
      queueProcessingState: r.queue_processing_state,
      updatedAt: iso(r.updated_at),
    };
  }

  async get(workerId) {
    const r = await this._query('SELECT * FROM worker_status WHERE worker_id = $1', [workerId]);
    return this._row(r.rows[0]);
  }

  async upsert(workerId, patch = {}) {
    const adopted = JSON.stringify(patch.adoptedConfigVersions || {});
    const r = await this._query(
      `INSERT INTO worker_status
         (worker_id, last_heartbeat_at, adopted_config_versions, last_job_started_at, last_job_completed_at, last_job_outcome, queue_processing_state, updated_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,COALESCE($7,'unknown'),now())
       ON CONFLICT (worker_id) DO UPDATE SET
         last_heartbeat_at     = COALESCE($2, worker_status.last_heartbeat_at),
         adopted_config_versions = worker_status.adopted_config_versions || $3::jsonb,
         last_job_started_at   = COALESCE($4, worker_status.last_job_started_at),
         last_job_completed_at = COALESCE($5, worker_status.last_job_completed_at),
         last_job_outcome      = COALESCE($6, worker_status.last_job_outcome),
         queue_processing_state = COALESCE($7, worker_status.queue_processing_state),
         updated_at            = now()
       RETURNING *`,
      [workerId, patch.lastHeartbeatAt ?? null, adopted, patch.lastJobStartedAt ?? null,
       patch.lastJobCompletedAt ?? null, patch.lastJobOutcome ?? null, patch.queueProcessingState ?? null]);
    return this._row(r.rows[0]);
  }
}

module.exports = { PostgresWorkerStatusRepository };
