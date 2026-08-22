'use strict';

const { query } = require('../db/pool');
const { AnalysisTemplate } = require('../domain/AnalysisTemplate');

function fromRow(row) {
  return new AnalysisTemplate({
    id:        row.id,
    name:      row.name,
    desc:      row.descr || '',
    iocs:      row.iocs || '',
    logs:      row.logs || '',
    actions:   row.actions || '',
    rec:       row.rec || '',
    notes:     row.notes || '',
    author:    row.author || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

class PostgresAnalysisTemplateRepository {
  async save(template) {
    const t = template instanceof AnalysisTemplate ? template : new AnalysisTemplate(template);
    t.updatedAt = new Date().toISOString();
    await query(`
      INSERT INTO analysis_templates (id,name,descr,iocs,logs,actions,rec,notes,author,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (id) DO UPDATE SET
        name=$2, descr=$3, iocs=$4, logs=$5, actions=$6, rec=$7, notes=$8, author=$9, updated_at=$11
    `, [t.id, t.name, t.desc, t.iocs, t.logs, t.actions, t.rec, t.notes, t.author, t.createdAt, t.updatedAt]);
    return t;
  }

  async findById(id) {
    const { rows } = await query('SELECT * FROM analysis_templates WHERE id=$1', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findByName(name) {
    const { rows } = await query('SELECT * FROM analysis_templates WHERE name=$1', [name]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findAll({ limit = 1000, offset = 0 } = {}) {
    const { rows } = await query('SELECT * FROM analysis_templates ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
    return rows.map(fromRow);
  }

  async delete(id) {
    const { rowCount } = await query('DELETE FROM analysis_templates WHERE id=$1', [id]);
    return rowCount > 0;
  }

  async count() {
    const { rows } = await query('SELECT COUNT(*) FROM analysis_templates');
    return parseInt(rows[0].count, 10);
  }
}

module.exports = { PostgresAnalysisTemplateRepository };
