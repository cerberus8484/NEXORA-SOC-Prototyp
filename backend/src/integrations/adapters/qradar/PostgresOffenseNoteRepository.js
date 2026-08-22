'use strict';

const { pool }       = require('../../../db/pool');
const { OffenseNote } = require('./OffenseNote');

/**
 * PostgresOffenseNoteRepository — Produktions-Implementierung.
 *
 * Verwendet Migration 025_qradar_offense_notes.sql.
 * Interface identisch zu InMemoryOffenseNoteRepository (LSP).
 */
class PostgresOffenseNoteRepository {
  /**
   * @param {OffenseNote} note
   * @returns {Promise<OffenseNote>}
   */
  async add(note) {
    const { rows } = await pool.query(
      `INSERT INTO qradar_offense_notes (id, offense_id, content, author, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [note.id, note.offenseId, note.content, note.author, note.createdAt],
    );
    return this._fromRow(rows[0]);
  }

  /**
   * @param {string} offenseId
   * @returns {Promise<OffenseNote[]>}
   */
  async listByOffense(offenseId) {
    const { rows } = await pool.query(
      `SELECT * FROM qradar_offense_notes
       WHERE offense_id = $1
       ORDER BY created_at ASC`,
      [offenseId],
    );
    return rows.map((r) => this._fromRow(r));
  }

  /** @private */
  _fromRow(row) {
    return OffenseNote.fromPersistence({
      id:        row.id,
      offenseId: row.offense_id,
      content:   row.content,
      author:    row.author,
      createdAt: row.created_at,
    });
  }
}

module.exports = { PostgresOffenseNoteRepository };
