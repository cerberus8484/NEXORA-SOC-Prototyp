'use strict';

// InMemoryNis2Repository (P_NIS2_1) — Tests/Dev (DB_ENABLED=false).
// Gleicher öffentlicher Vertrag wie PostgresNis2Repository.
// Speichert NUR Assessment-/Evidence-Metadaten (keine Secrets).

class InMemoryNis2Repository {
  constructor() {
    this._assessments = new Map(); // controlKey → assessment-JSON
    this._evidence    = new Map(); // id → evidence-JSON
  }

  // ─── Assessments (eindeutig pro controlKey) ───────────────────────────────
  async getAssessment(controlKey) {
    const a = this._assessments.get(controlKey);
    return a ? { ...a } : null;
  }
  async listAssessments() {
    return [...this._assessments.values()].map((a) => ({ ...a }));
  }
  async saveAssessment(domain) {
    const json = domain.toJSON();
    this._assessments.set(json.controlKey, { ...json });
    return { ...json };
  }

  // ─── Evidence-Links (mehrere je Assessment) ──────────────────────────────
  async addEvidence(domain) {
    const json = domain.toJSON();
    this._evidence.set(json.id, { ...json });
    return { ...json };
  }
  async getEvidence(id) {
    const e = this._evidence.get(id);
    return e ? { ...e } : null;
  }
  async listEvidence(assessmentId) {
    return [...this._evidence.values()].filter((e) => e.assessmentId === assessmentId).map((e) => ({ ...e }));
  }
  async listAllEvidence() {
    return [...this._evidence.values()].map((e) => ({ ...e }));
  }
  async deleteEvidence(id) {
    return this._evidence.delete(id);
  }
}

module.exports = { InMemoryNis2Repository };
