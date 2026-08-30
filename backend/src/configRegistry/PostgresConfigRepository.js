'use strict';

// P_CONFIG_1 — Postgres-Repository. Gleicher öffentlicher Vertrag wie
// InMemoryConfigRepository (fachlich identisch). queryFn injizierbar → ohne
// laufende DB testbar (Mapping-/Vertrags-Parität). KEINE Apply-/Exec-/Netz-/
// Datei-Operation; nur parametrisiertes SQL.

const { err } = require('./configCapabilityCatalog');

function iso(v) { return v instanceof Date ? v.toISOString() : (v == null ? v : String(v)); }

class PostgresConfigRepository {
  constructor({ queryFn } = {}) {
    if (typeof queryFn !== 'function') throw new Error('PostgresConfigRepository: queryFn erforderlich');
    this._q = queryFn;
  }

  _toDraft(r) {
    return { id: r.id, capabilityId: r.capability_id, targetId: r.target_id, value: r.value || {}, status: r.status, version: Number(r.version), revision: Number(r.revision), createdBy: r.created_by || '', createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
  }
  _toRevision(r) { return { id: r.id, draftId: r.draft_id, revision: Number(r.revision), value: r.value || {}, createdBy: r.created_by || '', createdAt: iso(r.created_at) }; }
  _toApproval(r) { return { id: r.id, draftId: r.draft_id, decision: r.decision, decidedBy: r.decided_by || '', note: r.note || '', decidedAt: iso(r.decided_at) }; }
  _toAudit(r) { return { id: r.id, type: r.type, actor: r.actor, capabilityId: r.capability_id, targetId: r.target_id, draftId: r.draft_id, before: r.before_redacted, after: r.after_redacted, at: iso(r.at) }; }

  async createDraft(d) {
    const r = await this._q(
      `INSERT INTO config_drafts (id, capability_id, target_id, value, status, version, revision, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [d.id, d.capabilityId, d.targetId, JSON.stringify(d.value ?? {}), d.status, d.version, d.revision, d.createdBy, d.createdAt, d.updatedAt],
    );
    return this._toDraft(r.rows[0]);
  }

  /** Compare-and-Set: WHERE id AND version=priorVersion → 409 bei Konflikt. */
  async updateDraft(d, priorVersion) {
    const r = await this._q(
      `UPDATE config_drafts SET capability_id=$2, target_id=$3, value=$4, status=$5, version=$6, revision=$7, created_by=$8, updated_at=$9
       WHERE id=$1 AND version=$10 RETURNING *`,
      [d.id, d.capabilityId, d.targetId, JSON.stringify(d.value ?? {}), d.status, d.version, d.revision, d.createdBy, d.updatedAt, priorVersion],
    );
    if (r.rowCount === 0) {
      const ex = await this._q('SELECT version FROM config_drafts WHERE id=$1', [d.id]);
      if (ex.rowCount === 0) throw err('Draft nicht gefunden', 404);
      throw err(`Optimistic-Lock-Konflikt (gespeichert ${ex.rows[0].version} ≠ erwartet ${priorVersion})`, 409);
    }
    return this._toDraft(r.rows[0]);
  }

  async findDraftById(id) {
    const r = await this._q('SELECT * FROM config_drafts WHERE id=$1', [id]);
    return r.rowCount ? this._toDraft(r.rows[0]) : null;
  }

  async listDrafts(filter = {}) {
    const where = []; const params = [];
    if (filter.capabilityId) { params.push(filter.capabilityId); where.push(`capability_id=$${params.length}`); }
    if (filter.targetId) { params.push(filter.targetId); where.push(`target_id=$${params.length}`); }
    if (filter.status) { params.push(filter.status); where.push(`status=$${params.length}`); }
    const sql = `SELECT * FROM config_drafts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at ASC`;
    const r = await this._q(sql, params);
    return r.rows.map((x) => this._toDraft(x));
  }

  async addRevision(rev) {
    const r = await this._q(
      `INSERT INTO config_draft_revisions (id, draft_id, revision, value, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [rev.id, rev.draftId, rev.revision, JSON.stringify(rev.value ?? {}), rev.createdBy, rev.createdAt],
    );
    return this._toRevision(r.rows[0]);
  }
  async listRevisions(draftId) {
    const r = await this._q('SELECT * FROM config_draft_revisions WHERE draft_id=$1 ORDER BY revision ASC', [draftId]);
    return r.rows.map((x) => this._toRevision(x));
  }

  async createApproval(a) {
    const r = await this._q(
      `INSERT INTO config_approvals (id, draft_id, decision, decided_by, note, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [a.id, a.draftId, a.decision, a.decidedBy, a.note, a.decidedAt],
    );
    return this._toApproval(r.rows[0]);
  }
  async listApprovals(draftId) {
    const r = await this._q('SELECT * FROM config_approvals WHERE draft_id=$1 ORDER BY decided_at ASC', [draftId]);
    return r.rows.map((x) => this._toApproval(x));
  }

  // Append-only: nur INSERT + SELECT (bewusst kein update/delete).
  async appendAudit(e) {
    const r = await this._q(
      `INSERT INTO config_change_audit (id, type, actor, capability_id, target_id, draft_id, before_redacted, after_redacted, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [e.id, e.type, e.actor, e.capabilityId, e.targetId, e.draftId, e.before == null ? null : JSON.stringify(e.before), e.after == null ? null : JSON.stringify(e.after), e.at],
    );
    return this._toAudit(r.rows[0]);
  }
  async listAudit(filter = {}) {
    const where = []; const params = [];
    if (filter.draftId) { params.push(filter.draftId); where.push(`draft_id=$${params.length}`); }
    if (filter.capabilityId) { params.push(filter.capabilityId); where.push(`capability_id=$${params.length}`); }
    const sql = `SELECT * FROM config_change_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at ASC`;
    const r = await this._q(sql, params);
    return r.rows.map((x) => this._toAudit(x));
  }
}

module.exports = { PostgresConfigRepository };
