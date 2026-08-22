'use strict';

// P_CORR_ADMIN_2 Stufe 2 — PostgresApplyRepository. Gleicher Vertrag wie InMemory.
// Single-flight + Replay über Partial-Unique-Indizes (Migration 044); ein Konflikt
// (23505) wird zu ACTIVE_RUN_CONFLICT bzw. PLAN_ALREADY_APPLIED normalisiert.
// writeRuntimeConfig ist transaktional (deactivate + insert neue aktive Version).

const { randomUUID } = require('crypto');
const { pool, query } = require('../db/pool');

const UNIQUE_VIOLATION = '23505';
function conflict(code, message) { const e = new Error(message); e.code = code; return e; }
function iso(v) { return v instanceof Date ? v.toISOString() : v; }

class PostgresApplyRepository {
  constructor({ queryFn = query, poolRef = pool } = {}) { this._query = queryFn; this._pool = poolRef; }

  _plan(r) { return r ? { id: r.id, draftId: r.draft_id, capabilityId: r.capability_id, targetId: r.target_id, value: r.value, planHash: r.plan_hash, expectedVersion: r.expected_version, createdBy: r.created_by, createdAt: iso(r.created_at) } : null; }
  _run(r) { return r ? { id: r.id, planId: r.plan_id, status: r.status, startedBy: r.started_by, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), configVersion: r.config_version, health: r.health, failureReason: r.failure_reason } : null; }
  _rc(r) { return r ? { id: r.id, capabilityId: r.capability_id, targetId: r.target_id, value: r.value, version: r.version, appliedBy: r.applied_by, active: r.active, createdAt: iso(r.created_at) } : null; }

  // ── Plans ──
  async createPlan(p) {
    const res = await this._query(
      `INSERT INTO apply_plans (id, draft_id, capability_id, target_id, value, plan_hash, expected_version, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [p.id, p.draftId, p.capabilityId, p.targetId, JSON.stringify(p.value ?? {}), p.planHash, p.expectedVersion, p.createdBy ?? '', p.createdAt]);
    return this._plan(res.rows[0]);
  }
  async findPlanById(id) { const r = await this._query('SELECT * FROM apply_plans WHERE id = $1', [id]); return this._plan(r.rows[0]); }
  async findPlanByHash(h) { const r = await this._query('SELECT * FROM apply_plans WHERE plan_hash = $1', [h]); return this._plan(r.rows[0]); }

  // ── Runs ──
  async createRun(run) {
    try {
      const res = await this._query(
        `INSERT INTO apply_runs (id, plan_id, status, started_by, started_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [run.id, run.planId, run.status, run.startedBy ?? '', run.startedAt]);
      return this._run(res.rows[0]);
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        const active = await this.findActiveRun();
        if (active) throw conflict('ACTIVE_RUN_CONFLICT', 'es läuft bereits ein Apply-Run');
        throw conflict('PLAN_ALREADY_APPLIED', 'Plan wurde bereits angewendet');
      }
      throw err;
    }
  }
  async updateRun(run) {
    const res = await this._query(
      `UPDATE apply_runs SET status=$2, finished_at=$3, config_version=$4, health=$5, failure_reason=$6 WHERE id=$1 RETURNING *`,
      [run.id, run.status, run.finishedAt ?? null, run.configVersion ?? null, run.health ? JSON.stringify(run.health) : null, run.failureReason ?? null]);
    return this._run(res.rows[0]);
  }
  async findRunById(id) { const r = await this._query('SELECT * FROM apply_runs WHERE id = $1', [id]); return this._run(r.rows[0]); }
  async findActiveRun() {
    const r = await this._query(`SELECT * FROM apply_runs WHERE status IN ('applying','reloading','rolling_back') ORDER BY started_at DESC LIMIT 1`, []);
    return this._run(r.rows[0]);
  }
  async findAppliedRunByPlan(planId) {
    const r = await this._query(`SELECT * FROM apply_runs WHERE plan_id = $1 AND status='applied' LIMIT 1`, [planId]);
    return this._run(r.rows[0]);
  }

  // ── Runtime-Config-Store (transaktional, versioniert) ──
  async getActiveRuntimeConfig(capabilityId, targetId) {
    const r = await this._query('SELECT * FROM runtime_config WHERE capability_id=$1 AND target_id=$2 AND active LIMIT 1', [capabilityId, targetId]);
    return this._rc(r.rows[0]);
  }
  async writeRuntimeConfig({ capabilityId, targetId, value, appliedBy = '' }) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE runtime_config SET active=FALSE WHERE capability_id=$1 AND target_id=$2 AND active', [capabilityId, targetId]);
      const v = await client.query('SELECT COALESCE(MAX(version),0)+1 AS next FROM runtime_config WHERE capability_id=$1 AND target_id=$2', [capabilityId, targetId]);
      const version = v.rows[0].next;
      const res = await client.query(
        `INSERT INTO runtime_config (id, capability_id, target_id, value, version, applied_by, active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE,now()) RETURNING *`,
        [randomUUID(), capabilityId, targetId, JSON.stringify(value ?? {}), version, appliedBy]);
      await client.query('COMMIT');
      return this._rc(res.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  }

  // ── Audit + Safety-Lock ──
  async appendApplyAudit(a) {
    await this._query(
      `INSERT INTO apply_audit (id, type, actor, plan_id, run_id, capability_id, detail, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [a.id, a.type, a.actor ?? null, a.planId ?? null, a.runId ?? null, a.capabilityId ?? null, a.detail ? JSON.stringify(a.detail) : null, a.at]);
    return { ...a };
  }
  async listApplyAudit(filter = {}) {
    const where = []; const params = []; let p = 1;
    if (filter.runId) { where.push(`run_id = $${p++}`); params.push(filter.runId); }
    if (filter.planId) { where.push(`plan_id = $${p++}`); params.push(filter.planId); }
    const sql = `SELECT * FROM apply_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC LIMIT 500`;
    const r = await this._query(sql, params);
    return r.rows.map((row) => ({ id: row.id, type: row.type, actor: row.actor, planId: row.plan_id, runId: row.run_id, capabilityId: row.capability_id, detail: row.detail, at: iso(row.at) }));
  }
  async getSafetyLock() {
    const r = await this._query(`SELECT * FROM apply_safety_lock WHERE id='global'`, []);
    const row = r.rows[0] || { locked: false, reason: '' };
    return { id: 'global', locked: !!row.locked, reason: row.reason || '', updatedAt: iso(row.updated_at) };
  }
  async setSafetyLock(locked, reason = '') {
    const r = await this._query(
      `INSERT INTO apply_safety_lock (id, locked, reason, updated_at) VALUES ('global',$1,$2,now())
       ON CONFLICT (id) DO UPDATE SET locked=$1, reason=$2, updated_at=now() RETURNING *`,
      [!!locked, String(reason || '')]);
    const row = r.rows[0];
    return { id: 'global', locked: !!row.locked, reason: row.reason || '', updatedAt: iso(row.updated_at) };
  }
}

module.exports = { PostgresApplyRepository };
