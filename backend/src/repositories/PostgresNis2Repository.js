'use strict';

// PostgresNis2Repository (P_NIS2_1) — DB_ENABLED=true.
// Gleicher öffentlicher Vertrag wie InMemoryNis2Repository.
// Migration 036_nis2.sql muss vorab laufen (beim API-Boot automatisch).

const { pool } = require('../db/pool');

class PostgresNis2Repository {
  _iso(v) { return v == null ? null : (v instanceof Date ? v.toISOString() : String(v)); }

  _toAssessment(r) {
    return r && {
      id: r.id, controlKey: r.control_key, status: r.status, owner: r.owner ?? '',
      dueDate: this._iso(r.due_date), notes: r.notes ?? '', lastReviewedAt: this._iso(r.last_reviewed_at),
      createdAt: this._iso(r.created_at), updatedAt: this._iso(r.updated_at),
      createdBy: r.created_by ?? '', updatedBy: r.updated_by ?? '',
    };
  }
  _toEvidence(r) {
    return r && {
      id: r.id, assessmentId: r.assessment_id, evidenceType: r.evidence_type, evidenceRef: r.evidence_ref,
      title: r.title, description: r.description ?? '', capturedAt: this._iso(r.captured_at),
      createdAt: this._iso(r.created_at), createdBy: r.created_by ?? '',
    };
  }

  // ─── Assessments (UNIQUE control_key → Upsert) ───────────────────────────
  async getAssessment(controlKey) {
    const { rows } = await pool.query('SELECT * FROM nis2_assessments WHERE control_key = $1', [controlKey]);
    return rows[0] ? this._toAssessment(rows[0]) : null;
  }
  async listAssessments() {
    const { rows } = await pool.query('SELECT * FROM nis2_assessments ORDER BY control_key ASC');
    return rows.map((r) => this._toAssessment(r));
  }
  async saveAssessment(domain) {
    const a = domain.toJSON();
    const { rows } = await pool.query(
      `INSERT INTO nis2_assessments (id, control_key, status, owner, due_date, notes, last_reviewed_at, created_at, updated_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (control_key) DO UPDATE SET
         status = EXCLUDED.status, owner = EXCLUDED.owner, due_date = EXCLUDED.due_date,
         notes = EXCLUDED.notes, last_reviewed_at = EXCLUDED.last_reviewed_at,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [a.id, a.controlKey, a.status, a.owner, a.dueDate, a.notes, a.lastReviewedAt, a.createdAt, a.updatedAt, a.createdBy, a.updatedBy]);
    return this._toAssessment(rows[0]);
  }

  // ─── Evidence-Links ──────────────────────────────────────────────────────
  async addEvidence(domain) {
    const e = domain.toJSON();
    const { rows } = await pool.query(
      `INSERT INTO nis2_evidence_links (id, assessment_id, evidence_type, evidence_ref, title, description, captured_at, created_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [e.id, e.assessmentId, e.evidenceType, e.evidenceRef, e.title, e.description, e.capturedAt, e.createdAt, e.createdBy]);
    return this._toEvidence(rows[0]);
  }
  async getEvidence(id) {
    const { rows } = await pool.query('SELECT * FROM nis2_evidence_links WHERE id = $1', [id]);
    return rows[0] ? this._toEvidence(rows[0]) : null;
  }
  async listEvidence(assessmentId) {
    const { rows } = await pool.query('SELECT * FROM nis2_evidence_links WHERE assessment_id = $1 ORDER BY created_at ASC', [assessmentId]);
    return rows.map((r) => this._toEvidence(r));
  }
  async listAllEvidence() {
    const { rows } = await pool.query('SELECT * FROM nis2_evidence_links ORDER BY created_at ASC');
    return rows.map((r) => this._toEvidence(r));
  }
  async deleteEvidence(id) {
    const { rowCount } = await pool.query('DELETE FROM nis2_evidence_links WHERE id = $1', [id]);
    return rowCount > 0;
  }
}

module.exports = { PostgresNis2Repository };
