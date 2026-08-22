'use strict';

/** In-Memory-Repository für Agent-Suggestions (Tests/Dev). */
class InMemoryAgentSuggestionRepository {
  constructor() { this._items = new Map(); }

  async save(suggestion) {
    this._items.set(suggestion.id, suggestion);
    return suggestion;
  }

  async findById(id) {
    return this._items.get(id) || null;
  }

  async findAll({ status, ticketId, limit = 1000, offset = 0 } = {}) {
    let list = [...this._items.values()];
    if (status)   list = list.filter((s) => s.status === status);
    if (ticketId) list = list.filter((s) => s.ticketId === ticketId);
    return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(offset, offset + limit);
  }

  async delete(id) {
    return this._items.delete(id);
  }

  async count() { return this._items.size; }
}

module.exports = { InMemoryAgentSuggestionRepository };
