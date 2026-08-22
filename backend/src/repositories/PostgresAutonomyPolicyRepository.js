'use strict';

/**
 * PostgresAutonomyPolicyRepository
 *
 * Postgres-Implementierung des AutonomyPolicy-Repository (DB_ENABLED=true).
 * Gleicher Vertrag wie InMemoryAutonomyPolicyRepository.
 * Migration 027_autonomy_policies.sql muss vorab laufen.
 */

const { pool }          = require('../db/pool');
const { AutonomyPolicy } = require('../domain/AutonomyPolicy');

// snake_case DB-Spalten → camelCase Domain-Felder
function _toDomain(row) {
  if (!row) return null;
  return new AutonomyPolicy({
    id:                   row.id,
    customer:             row.customer,
    actionClass:          row.action_class,
    mode:                 row.mode,
    minVerdict:           row.min_verdict,
    minConfidence:        Number(row.min_confidence),
    requireEvidenceFloor: Boolean(row.require_evidence_floor),
    maxPerHour:           Number(row.max_per_hour),
    enabled:              Boolean(row.enabled),
    createdBy:            row.created_by,
    createdAt:            row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at || ''),
    updatedAt:            row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at || ''),
  });
}

class PostgresAutonomyPolicyRepository {
  // ─── create ───────────────────────────────────────────────────────────────

  async create(data) {
    const policy = data instanceof AutonomyPolicy
      ? data
      : AutonomyPolicy.create(data);

    const sql = `
      INSERT INTO autonomy_policies
        (id, customer, action_class, mode, min_verdict, min_confidence,
         require_evidence_floor, max_per_hour, enabled, created_by, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `;
    try {
      const { rows } = await pool.query(sql, [
        policy.id, policy.customer, policy.actionClass, policy.mode,
        policy.minVerdict, policy.minConfidence, policy.requireEvidenceFloor,
        policy.maxPerHour, policy.enabled, policy.createdBy,
        policy.createdAt, policy.updatedAt,
      ]);
      return _toDomain(rows[0]).toJSON();
    } catch (err) {
      if (err.code === '23505') { // unique_violation
        throw Object.assign(
          new Error(
            `Unique-Constraint verletzt: Policy für customer='${policy.customer}' ` +
            `und actionClass='${policy.actionClass}' existiert bereits.`
          ),
          { status: 409, code: 'UNIQUE_SCOPE_VIOLATION' }
        );
      }
      throw err;
    }
  }

  // ─── findById ─────────────────────────────────────────────────────────────

  async findById(id) {
    const { rows } = await pool.query(
      'SELECT * FROM autonomy_policies WHERE id = $1',
      [id]
    );
    return rows[0] ? _toDomain(rows[0]).toJSON() : null;
  }

  // ─── findAll → { data, total } ────────────────────────────────────────────

  async findAll({ limit = 50, offset = 0 } = {}) {
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        'SELECT * FROM autonomy_policies ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM autonomy_policies'),
    ]);
    return {
      data:  dataRes.rows.map((r) => _toDomain(r).toJSON()),
      total: Number(countRes.rows[0].count),
    };
  }

  // ─── update ───────────────────────────────────────────────────────────────

  async update(id, patch) {
    const existing = await this.findById(id);
    if (!existing) return null;

    // Domain-Update (Validierung + Whitelist)
    const policy  = _toDomain(null); // dummy — wir brauchen die Instanz
    // Rebuild aus DB-Daten und wende Patch an
    const instance = new AutonomyPolicy(existing);
    const updated  = instance.update(patch);

    const sql = `
      UPDATE autonomy_policies
      SET customer=$1, mode=$2, min_verdict=$3, min_confidence=$4,
          require_evidence_floor=$5, max_per_hour=$6, enabled=$7,
          created_by=$8, updated_at=$9
      WHERE id=$10
      RETURNING *
    `;
    const { rows } = await pool.query(sql, [
      updated.customer, updated.mode, updated.minVerdict, updated.minConfidence,
      updated.requireEvidenceFloor, updated.maxPerHour, updated.enabled,
      updated.createdBy, updated.updatedAt, id,
    ]);
    return rows[0] ? _toDomain(rows[0]).toJSON() : null;
  }

  // ─── delete ───────────────────────────────────────────────────────────────

  async delete(id) {
    await pool.query('DELETE FROM autonomy_policies WHERE id = $1', [id]);
  }

  // ─── findByCustomerAndClass ───────────────────────────────────────────────

  async findByCustomerAndClass(customer, actionClass) {
    const { rows } = await pool.query(
      'SELECT * FROM autonomy_policies WHERE customer = $1 AND action_class = $2',
      [customer, actionClass]
    );
    return rows[0] ? _toDomain(rows[0]).toJSON() : null;
  }
}

module.exports = { PostgresAutonomyPolicyRepository };
