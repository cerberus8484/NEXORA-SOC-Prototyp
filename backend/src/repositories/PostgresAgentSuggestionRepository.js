'use strict';

const { query } = require('../db/pool');
const { AgentSuggestion } = require('../domain/AgentSuggestion');

function fromRow(row) {
  return new AgentSuggestion({
    id:           row.id,
    ticketId:     row.ticket_id,
    kind:         row.kind,
    proposal:     row.proposal,
    rationale:    row.rationale,
    verdict:      row.verdict || '',
    confidence:   Number(row.confidence),
    status:       row.status,
    createdBy:    row.created_by,
    model:        row.model || '',
    reviewedBy:   row.reviewed_by,
    reviewReason: row.review_reason || '',
    reviewedAt:   row.reviewed_at,
    createdAt:    row.created_at,
    analysis:     row.analysis || null,
  });
}

class PostgresAgentSuggestionRepository {
  async save(suggestion) {
    const s = suggestion instanceof AgentSuggestion ? suggestion : new AgentSuggestion(suggestion);
    await query(`
      INSERT INTO agent_suggestions
        (id,ticket_id,kind,proposal,rationale,confidence,status,created_by,model,reviewed_by,review_reason,reviewed_at,created_at,verdict,analysis)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (id) DO UPDATE SET
        status=$7, reviewed_by=$10, review_reason=$11, reviewed_at=$12, verdict=$14, analysis=$15
    `, [s.id, s.ticketId, s.kind, s.proposal, s.rationale, s.confidence, s.status,
        s.createdBy, s.model, s.reviewedBy, s.reviewReason, s.reviewedAt, s.createdAt, s.verdict || '',
        s.analysis ? JSON.stringify(s.analysis) : null]);
    return s;
  }

  async findById(id) {
    const { rows } = await query('SELECT * FROM agent_suggestions WHERE id=$1', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findAll({ status, ticketId, limit = 1000, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    if (status)   { params.push(status);   conditions.push(`status=$${params.length}`); }
    if (ticketId) { params.push(ticketId); conditions.push(`ticket_id=$${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);
    const { rows } = await query(`SELECT * FROM agent_suggestions ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return rows.map(fromRow);
  }

  async delete(id) {
    const { rowCount } = await query('DELETE FROM agent_suggestions WHERE id=$1', [id]);
    return rowCount > 0;
  }

  async count() {
    const { rows } = await query('SELECT COUNT(*) FROM agent_suggestions');
    return parseInt(rows[0].count, 10);
  }
}

module.exports = { PostgresAgentSuggestionRepository };
