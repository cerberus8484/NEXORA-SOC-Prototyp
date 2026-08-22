'use strict';

// InMemory-Dataplane-Status-Repo (Dev/Test, flüchtig). Gleicher Vertrag wie Postgres.
// Ein Snapshot je nodeId (upsert ersetzt vollständig). list() liefert alle Knoten.

class InMemoryDataplaneStatusRepository {
  constructor() { this._byId = new Map(); }

  async get(nodeId) {
    const s = this._byId.get(nodeId);
    return s ? { ...s } : null;
  }

  async list() {
    return [...this._byId.values()].map((s) => ({ ...s }));
  }

  async upsert(nodeId, snapshot = {}) {
    const nowIso = new Date().toISOString();
    const merged = {
      nodeId,
      reportedAt: snapshot.reportedAt ?? null,
      receivedAt: nowIso,
      collectors: Array.isArray(snapshot.collectors) ? snapshot.collectors : [],
      intake: snapshot.intake ?? {},
      outbox: snapshot.outbox ?? {},
      updatedAt: nowIso,
    };
    this._byId.set(nodeId, merged);
    return { ...merged };
  }

  // Test-Helfer
  clear() { this._byId.clear(); }
}

module.exports = { InMemoryDataplaneStatusRepository };
