'use strict';

const { query } = require('../db/pool');
const { UseCase } = require('../domain/UseCase');

function fromRow(row) {
  return new UseCase({
    id:        row.id,
    value:     row.value,
    author:    row.author || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

class PostgresUseCaseRepository {
  async save(useCase) {
    const uc = useCase instanceof UseCase ? useCase : new UseCase(useCase);
    uc.updatedAt = new Date().toISOString();
    await query(`
      INSERT INTO use_cases (id,value,author,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET value=$2, author=$3, updated_at=$5
    `, [uc.id, uc.value, uc.author, uc.createdAt, uc.updatedAt]);
    return uc;
  }

  async findById(id) {
    const { rows } = await query('SELECT * FROM use_cases WHERE id=$1', [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findByValue(value) {
    const { rows } = await query('SELECT * FROM use_cases WHERE value=$1', [value]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findAll({ limit = 1000, offset = 0 } = {}) {
    const { rows } = await query('SELECT * FROM use_cases ORDER BY value ASC LIMIT $1 OFFSET $2', [limit, offset]);
    return rows.map(fromRow);
  }

  async delete(id) {
    const { rowCount } = await query('DELETE FROM use_cases WHERE id=$1', [id]);
    return rowCount > 0;
  }

  async count() {
    const { rows } = await query('SELECT COUNT(*) FROM use_cases');
    return parseInt(rows[0].count, 10);
  }
}

module.exports = { PostgresUseCaseRepository };
