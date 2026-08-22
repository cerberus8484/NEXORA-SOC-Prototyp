'use strict';

const { query }            = require('../db/pool');
const { WazuhFpException } = require('../domain/WazuhFpException');

const ACTIVE = ['applied', 'restart_required', 'active'];

function toRow(e) {
  return {
    id: e.id,
    ticket_id: e.ticketId || null,
    parent_rule_id: e.parentRuleId || '',
    generated_rule_id: e.generatedRuleId ?? null,
    scope_hash: e.scopeHash || '',
    scope: JSON.stringify({ srcips: e.srcips || [], dstips: e.dstips || [], dstports: e.dstports || [], protocol: e.protocol || '', agentId: e.agentId || '', reason: e.reason || '' }),
    xml: e.xml || '',
    file: e.file || 'soc_fp_exceptions.xml',
    status: e.status || 'draft',
    created_by: e.createdBy || '',
    approved_by: e.approvedBy || '',
    before_hash: e.beforeHash || '',
    after_hash: e.afterHash || '',
    last_error: e.lastError || '',
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    applied_at: e.appliedAt || null,
    reverted_at: e.revertedAt || null,
  };
}

function fromRow(r) {
  if (!r) return null;
  const s = r.scope || {};
  return new WazuhFpException({
    id: r.id,
    ticketId: r.ticket_id || '',
    parentRuleId: r.parent_rule_id || '',
    generatedRuleId: r.generated_rule_id ?? null,
    srcips: s.srcips || [], dstips: s.dstips || [], dstports: s.dstports || [],
    protocol: s.protocol || '', agentId: s.agentId || '', reason: s.reason || '',
    scopeHash: r.scope_hash || '',
    xml: r.xml || '', file: r.file || 'soc_fp_exceptions.xml', status: r.status || 'draft',
    createdBy: r.created_by || '', approvedBy: r.approved_by || '',
    beforeHash: r.before_hash || '', afterHash: r.after_hash || '', lastError: r.last_error || '',
    createdAt: r.created_at?.toISOString?.() || r.created_at,
    updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    appliedAt: r.applied_at?.toISOString?.() || r.applied_at || null,
    revertedAt: r.reverted_at?.toISOString?.() || r.reverted_at || null,
  }).toJSON();
}

class PostgresWazuhFpExceptionRepository {
  async create(entity) {
    const e = entity instanceof WazuhFpException ? entity : WazuhFpException.create(entity);
    const r = toRow(e);
    await query(`
      INSERT INTO wazuh_fp_exceptions
        (id, ticket_id, parent_rule_id, generated_rule_id, scope_hash, scope, xml, file, status,
         created_by, approved_by, before_hash, after_hash, last_error, created_at, updated_at, applied_at, reverted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    `, [r.id, r.ticket_id, r.parent_rule_id, r.generated_rule_id, r.scope_hash, r.scope, r.xml, r.file, r.status,
        r.created_by, r.approved_by, r.before_hash, r.after_hash, r.last_error, r.created_at, r.updated_at, r.applied_at, r.reverted_at]);
    return this.findById(r.id);
  }

  async update(id, patch) {
    const cur = await this._raw(id);
    if (!cur) return null;
    const merged = new WazuhFpException(fromRow(cur)).update(patch);
    const r = toRow(merged);
    await query(`
      UPDATE wazuh_fp_exceptions SET
        generated_rule_id=$2, xml=$3, status=$4, approved_by=$5,
        before_hash=$6, after_hash=$7, last_error=$8,
        updated_at=$9, applied_at=$10, reverted_at=$11
      WHERE id=$1
    `, [id, r.generated_rule_id, r.xml, r.status, r.approved_by, r.before_hash, r.after_hash, r.last_error, r.updated_at, r.applied_at, r.reverted_at]);
    return this.findById(id);
  }

  async _raw(id) {
    const res = await query('SELECT * FROM wazuh_fp_exceptions WHERE id=$1', [id]);
    return res.rows[0] || null;
  }

  async findById(id) { return fromRow(await this._raw(id)); }

  async findByTicket(ticketId) {
    const res = await query('SELECT * FROM wazuh_fp_exceptions WHERE ticket_id=$1 ORDER BY created_at DESC', [ticketId]);
    return res.rows.map(fromRow);
  }

  async findActiveByScopeHash(scopeHash) {
    const res = await query(
      'SELECT * FROM wazuh_fp_exceptions WHERE scope_hash=$1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 1',
      [scopeHash, ACTIVE],
    );
    return fromRow(res.rows[0]);
  }

  async findAll({ limit = 1000, offset = 0 } = {}) {
    const res = await query('SELECT * FROM wazuh_fp_exceptions ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return res.rows.map(fromRow);
  }
}

module.exports = { PostgresWazuhFpExceptionRepository };
