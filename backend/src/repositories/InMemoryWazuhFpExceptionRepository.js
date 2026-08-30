'use strict';

const { WazuhFpException } = require('../domain/WazuhFpException');

// In-Memory-Variante (Tests/Dev). Gleicher Vertrag wie die Postgres-Variante.
const ACTIVE = new Set(['applied', 'restart_required', 'active']);

class InMemoryWazuhFpExceptionRepository {
  constructor() { this._byId = new Map(); }

  async create(entity) {
    const e = entity instanceof WazuhFpException ? entity : WazuhFpException.create(entity);
    this._byId.set(e.id, e);
    return e.toJSON();
  }

  async update(id, patch) {
    const e = this._byId.get(id);
    if (!e) return null;
    e.update(patch);
    return e.toJSON();
  }

  async findById(id) {
    const e = this._byId.get(id);
    return e ? e.toJSON() : null;
  }

  async findByTicket(ticketId) {
    return [...this._byId.values()].filter((e) => e.ticketId === ticketId).map((e) => e.toJSON());
  }

  /** Aktive (nicht reverted/failed/draft) Ausnahme mit gleichem Scope → Idempotenz. */
  async findActiveByScopeHash(scopeHash) {
    const e = [...this._byId.values()].find((x) => x.scopeHash === scopeHash && ACTIVE.has(x.status));
    return e ? e.toJSON() : null;
  }

  async findAll({ limit = 1000, offset = 0 } = {}) {
    return [...this._byId.values()].map((e) => e.toJSON()).slice(offset, offset + limit);
  }
}

module.exports = { InMemoryWazuhFpExceptionRepository };
