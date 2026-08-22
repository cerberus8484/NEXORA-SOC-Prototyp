'use strict';

const { Evidence } = require('../domain/Evidence');

// Append-only Evidence-Store (Tests/Dev). Kein update/delete — Chain of Custody.
class InMemoryEvidenceRepository {
  constructor() { this._m = new Map(); }
  clear() { this._m.clear(); }

  async create(data) {
    const e = data instanceof Evidence ? data : Evidence.create(data);
    this._m.set(e.id, e.toJSON());
    return e.toJSON();
  }

  async findById(id) { return this._m.get(id) || null; }

  async findByTicket(ticketId) {
    return [...this._m.values()]
      .filter((e) => e.ticketId === ticketId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async findAll({ limit = 200 } = {}) {
    return [...this._m.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }
}

module.exports = { InMemoryEvidenceRepository };
