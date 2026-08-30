'use strict';

const { UseCaseDraft } = require('../domain/UseCaseDraft');

/**
 * In-Memory-Implementierung des UseCaseDraft-Repository (Tests/Dev).
 * Gleicher Vertrag wie PostgresUseCaseDraftRepository.
 */
class InMemoryUseCaseDraftRepository {
  constructor() {
    this._byId = new Map();
    this._ucSeq = 0; // In-Process-Zähler (analog Postgres-Sequenz); reset beim Neustart
  }

  /** Nächste fortlaufende Use-Case-Nummer (Integer; die App formatiert UC-INC000001). */
  async nextUseCaseNumber() {
    this._ucSeq += 1;
    return this._ucSeq;
  }

  async create(data) {
    const draft = data instanceof UseCaseDraft ? data : UseCaseDraft.create(data);
    this._byId.set(draft.id, draft);
    return draft.toJSON();
  }

  async update(id, patch) {
    const draft = this._byId.get(id);
    if (!draft) return null;
    draft.update(patch);
    return draft.toJSON();
  }

  async findById(id) {
    const draft = this._byId.get(id);
    return draft ? draft.toJSON() : null;
  }

  // Neueste zuerst (createdAt DESC) — gemeinsame Sortierung.
  _sorted() {
    return [...this._byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  // Vertrag wie die anderen Repos: { data, total } + LIMIT/OFFSET (keine unbounded Liste).
  async findAll({ limit = 50, offset = 0 } = {}) {
    const all = this._sorted();
    return { data: all.slice(offset, offset + limit).map((d) => d.toJSON()), total: all.length };
  }

  async findByStatus(status, { limit = 50, offset = 0 } = {}) {
    const all = this._sorted().filter((d) => d.status === status);
    return { data: all.slice(offset, offset + limit).map((d) => d.toJSON()), total: all.length };
  }

  async findBySource(sourceType, sourceId, { limit = 100, offset = 0 } = {}) {
    const all = this._sorted().filter((d) => d.sourceType === sourceType && d.sourceId === sourceId);
    return { data: all.slice(offset, offset + limit).map((d) => d.toJSON()), total: all.length };
  }

  // Persistiert einen Status-Übergang (Validierung erfolgt vorher in der Domain).
  async setStatus(id, status, reviewedBy) {
    const draft = this._byId.get(id);
    if (!draft) return null;
    draft.status     = status;
    draft.reviewedBy = reviewedBy ?? draft.reviewedBy ?? null;
    draft.updatedAt  = new Date().toISOString();
    return draft.toJSON();
  }

  async delete(id) {
    this._byId.delete(id);
  }

  /** Hilfsmethode für Tests — Anzahl gespeicherter Drafts */
  size() {
    return this._byId.size;
  }
}

module.exports = { InMemoryUseCaseDraftRepository };
