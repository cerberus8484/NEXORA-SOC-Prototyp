'use strict';

const { CustodyEvent } = require('../domain/CustodyEvent');

// Append-only Custody-Events (Tests/Dev).
class InMemoryCustodyRepository {
  constructor() { this._m = new Map(); }
  clear() { this._m.clear(); }

  async create(data) {
    const e = data instanceof CustodyEvent ? data : CustodyEvent.create(data);
    this._m.set(e.id, e.toJSON());
    return e.toJSON();
  }

  async findByEvidence(evidenceId) {
    return [...this._m.values()]
      .filter((e) => e.evidenceId === evidenceId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  // Batch: ein Aufruf für mehrere Evidence-IDs → kein N+1.
  // Rückgabe: { [evidenceId]: CustodyEvent[] } (aufsteigend nach createdAt).
  async findByEvidenceIds(ids) {
    const idSet = new Set(ids);
    const grouped = {};
    for (const e of this._m.values()) {
      if (idSet.has(e.evidenceId)) {
        (grouped[e.evidenceId] ||= []).push(e);
      }
    }
    for (const arr of Object.values(grouped)) {
      arr.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }
    return grouped;
  }
}

module.exports = { InMemoryCustodyRepository };
