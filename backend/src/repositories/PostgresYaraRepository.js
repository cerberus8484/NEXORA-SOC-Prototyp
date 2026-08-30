'use strict';

const { query } = require('../db/pool');
const { YaraRule } = require('../domain/YaraRule');

function toRow(r) {
  return {
    id:           r.id,
    name:         r.name,
    description:  r.description,
    tags:         r.tags,
    patterns:     JSON.stringify(r.patterns),
    condition:    JSON.stringify(r.condition),
    enabled:      r.enabled,
    author:       r.author,
    severity:     r.severity,
    mitre_attack: r.mitreAttack,
    created_at:   r.createdAt,
    updated_at:   r.updatedAt,
  };
}

function fromRow(row) {
  return new YaraRule({
    id:          row.id,
    name:        row.name,
    description: row.description,
    tags:        row.tags || [],
    patterns:    typeof row.patterns === 'string' ? JSON.parse(row.patterns) : (row.patterns || []),
    condition:   typeof row.condition === 'string' ? JSON.parse(row.condition) : (row.condition ?? 'any'),
    enabled:     row.enabled,
    author:      row.author || '',
    severity:    row.severity || 'medium',
    mitreAttack: row.mitre_attack || '',
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  });
}

class PostgresYaraRepository {
  async save(rule) {
    const r = rule instanceof YaraRule ? rule : new YaraRule(rule);
    r.updatedAt = new Date().toISOString();
    const row = toRow(r);
    await query(`
      INSERT INTO yara_rules (id,name,description,tags,patterns,condition,enabled,author,severity,mitre_attack,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        name=$2, description=$3, tags=$4, patterns=$5::jsonb, condition=$6::jsonb,
        enabled=$7, author=$8, severity=$9, mitre_attack=$10, updated_at=$12
    `, [row.id, row.name, row.description, row.tags, row.patterns, row.condition,
        row.enabled, row.author, row.severity, row.mitre_attack, row.created_at, row.updated_at]);
    return r;
  }

  async findById(id) {
    const { rows } = await query('SELECT * FROM yara_rules WHERE id=$1', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findByName(name) {
    const { rows } = await query('SELECT * FROM yara_rules WHERE name=$1', [name]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findAll({ enabledOnly = false, tag, limit = 1000, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    if (enabledOnly) { conditions.push('enabled=TRUE'); }
    if (tag) { params.push(tag); conditions.push(`$${params.length}=ANY(tags)`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);
    const { rows } = await query(`SELECT * FROM yara_rules ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return rows.map(fromRow);
  }

  async delete(id) {
    const { rowCount } = await query('DELETE FROM yara_rules WHERE id=$1', [id]);
    return rowCount > 0;
  }

  async count() {
    const { rows } = await query('SELECT COUNT(*) FROM yara_rules');
    return parseInt(rows[0].count, 10);
  }
}

module.exports = { PostgresYaraRepository };
