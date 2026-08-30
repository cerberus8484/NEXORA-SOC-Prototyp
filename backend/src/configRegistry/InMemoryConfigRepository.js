'use strict';

// P_CONFIG_1 — InMemory-Repository für Tests/Dev (flüchtig). Gleicher Vertrag wie
// PostgresConfigRepository. KEINE Apply-/Exec-/Netz-/Datei-Operation.
// Optimistic Locking via Compare-and-Set auf der Vorversion (verhindert Lost-Update).

const { err } = require('./configCapabilityCatalog');

class InMemoryConfigRepository {
  constructor() {
    this._drafts = new Map();   // id → draftJSON
    this._revisions = [];        // append-only Wert-Historie
    this._approvals = [];        // append-only Entscheide
    this._audit = [];            // append-only Audit
  }

  async createDraft(json) {
    if (this._drafts.has(json.id)) throw err('Draft existiert bereits', 409);
    this._drafts.set(json.id, { ...json });
    return { ...json };
  }

  /** Compare-and-Set: aktualisiert nur, wenn die gespeicherte Version == priorVersion. */
  async updateDraft(json, priorVersion) {
    const cur = this._drafts.get(json.id);
    if (!cur) throw err('Draft nicht gefunden', 404);
    if (Number(cur.version) !== Number(priorVersion)) {
      throw err(`Optimistic-Lock-Konflikt (gespeichert ${cur.version} ≠ erwartet ${priorVersion})`, 409);
    }
    this._drafts.set(json.id, { ...json });
    return { ...json };
  }

  async findDraftById(id) { const d = this._drafts.get(id); return d ? { ...d } : null; }

  async listDrafts(filter = {}) {
    let arr = [...this._drafts.values()];
    if (filter.capabilityId) arr = arr.filter((d) => d.capabilityId === filter.capabilityId);
    if (filter.targetId) arr = arr.filter((d) => d.targetId === filter.targetId);
    if (filter.status) arr = arr.filter((d) => d.status === filter.status);
    return arr.map((d) => ({ ...d })).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  async addRevision(json) { this._revisions.push({ ...json }); return { ...json }; }
  async listRevisions(draftId) {
    return this._revisions.filter((r) => r.draftId === draftId).map((r) => ({ ...r })).sort((a, b) => a.revision - b.revision);
  }

  async createApproval(json) { this._approvals.push({ ...json }); return { ...json }; }
  async listApprovals(draftId) { return this._approvals.filter((a) => a.draftId === draftId).map((a) => ({ ...a })); }

  async appendAudit(json) { this._audit.push({ ...json }); return { ...json }; }
  async listAudit(filter = {}) {
    let arr = [...this._audit];
    if (filter.draftId) arr = arr.filter((x) => x.draftId === filter.draftId);
    if (filter.capabilityId) arr = arr.filter((x) => x.capabilityId === filter.capabilityId);
    return arr.map((x) => ({ ...x })).sort((a, b) => (a.at < b.at ? -1 : 1));
  }
}

module.exports = { InMemoryConfigRepository };
