'use strict';

const { PublishedDetection } = require('../domain/PublishedDetection');

/**
 * In-Memory-Implementierung des PublishedDetection-Repository.
 * Gleicher Vertrag wie PostgresPublishedDetectionRepository.
 *
 * Schlüssel-Invariante: pro draftId nur ein Eintrag (UNIQUE idx_published_detections_draft
 * aus Migration 026). Der Idempotenz-Guard liegt im Service — das Repo selbst überschreibt,
 * wenn create() erneut für dieselbe draftId gerufen wird (wie PK-Konflikt in Postgres).
 */
class InMemoryPublishedDetectionRepository {
  constructor() {
    // Primärindex: id → PublishedDetection
    this._byId      = new Map();
    // Sekundärindex: draftId → id (für O(1)-findByDraftId)
    this._byDraftId = new Map();
  }

  /**
   * Persistiert eine PublishedDetection.
   * Akzeptiert eine Domain-Instanz oder ein Plain-Objekt.
   * @returns {object} Plain JSON (toJSON())
   */
  async create(detection) {
    const pd = detection instanceof PublishedDetection
      ? detection
      : new PublishedDetection(detection);

    // Falls für diese draftId bereits ein Eintrag existiert, alten entfernen
    // (entspricht ON CONFLICT DO NOTHING in Postgres — dort passiert gar nichts,
    // hier überschreiben wir für Konsistenz; der Service ruft create() nie doppelt).
    const existingId = this._byDraftId.get(pd.draftId);
    if (existingId) {
      this._byId.delete(existingId);
    }

    this._byId.set(pd.id, pd);
    this._byDraftId.set(pd.draftId, pd.id);
    return pd.toJSON();
  }

  /**
   * Sucht den Detection-Eintrag zu einer draftId (für Idempotenz-Check im Service).
   * @returns {object|null}
   */
  async findByDraftId(draftId) {
    const id = this._byDraftId.get(draftId);
    if (!id) return null;
    const pd = this._byId.get(id);
    return pd ? pd.toJSON() : null;
  }

  /**
   * Alle Einträge, neueste zuerst (createdAt DESC), paginiert.
   * @returns {{ data: object[], total: number }}
   */
  async findAll({ limit = 50, offset = 0 } = {}) {
    const sorted = [...this._byId.values()].sort(
      (a, b) => (a.createdAt < b.createdAt ? 1 : -1)
    );
    return {
      data:  sorted.slice(offset, offset + limit).map((pd) => pd.toJSON()),
      total: sorted.length,
    };
  }

  /** Hilfsmethode für Tests */
  size() {
    return this._byId.size;
  }
}

module.exports = { InMemoryPublishedDetectionRepository };
