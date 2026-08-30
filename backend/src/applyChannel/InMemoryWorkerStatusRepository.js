'use strict';

// P_CORR_ADMIN_2 Stufe 3 — InMemory-Worker-Status-Repo (Dev/Test, flüchtig).
// Gleicher Vertrag wie Postgres. adoptedConfigVersions wird als Map gemerged.

class InMemoryWorkerStatusRepository {
  constructor() { this._byId = new Map(); }

  async get(workerId) {
    const s = this._byId.get(workerId);
    return s ? { ...s, adoptedConfigVersions: { ...s.adoptedConfigVersions } } : null;
  }

  async upsert(workerId, patch = {}) {
    const cur = this._byId.get(workerId) || { workerId, adoptedConfigVersions: {}, queueProcessingState: 'unknown' };
    const merged = {
      ...cur,
      ...patch,
      workerId,
      adoptedConfigVersions: { ...(cur.adoptedConfigVersions || {}), ...(patch.adoptedConfigVersions || {}) },
      updatedAt: new Date().toISOString(),
    };
    this._byId.set(workerId, merged);
    return { ...merged, adoptedConfigVersions: { ...merged.adoptedConfigVersions } };
  }

  // Test-Helfer
  clear() { this._byId.clear(); }
}

module.exports = { InMemoryWorkerStatusRepository };
