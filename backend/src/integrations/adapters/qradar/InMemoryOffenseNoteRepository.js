'use strict';

const { OffenseNote } = require('./OffenseNote');

/**
 * InMemoryOffenseNoteRepository — Testdoppel + Dev-Implementierung.
 *
 * Interface:
 *   add(note)               → note
 *   listByOffense(offenseId) → note[] (chronologisch, älteste zuerst)
 *   clear()                 → void  (nur für Tests)
 */
class InMemoryOffenseNoteRepository {
  constructor() {
    /** @type {Map<string, object>} id → note-plain-object */
    this._notes = new Map();
  }

  /**
   * @param {OffenseNote} note
   * @returns {Promise<OffenseNote>}
   */
  async add(note) {
    this._notes.set(note.id, { ...note, createdAt: note.createdAt });
    return OffenseNote.fromPersistence({ ...note });
  }

  /**
   * @param {string} offenseId
   * @returns {Promise<OffenseNote[]>}
   */
  async listByOffense(offenseId) {
    return [...this._notes.values()]
      .filter((n) => n.offenseId === offenseId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((n) => OffenseNote.fromPersistence({ ...n }));
  }

  /** Test-Utility */
  clear() {
    this._notes.clear();
  }
}

module.exports = { InMemoryOffenseNoteRepository };
