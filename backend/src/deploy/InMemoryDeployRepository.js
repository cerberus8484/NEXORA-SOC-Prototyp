'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — InMemory-Deploy-Repository (Tests/Dev).
//
// Gleicher Vertrag wie das Postgres-Repo. Single-flight + Replay als Backstop
// (analog den Teil-Indizes in Migration 051). Steps/Audit sind append-only
// (keine update/delete-Methoden).
// ─────────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(['applying', 'cloning', 'starting', 'configuring', 'verifying', 'rolling_back']);

function conflict(code, message) { return Object.assign(new Error(message), { code }); }

class InMemoryDeployRepository {
  constructor() {
    this._connectors = new Map();
    this._specs = new Map();
    this._runs = new Map();
    this._steps = [];
    this._audit = [];
    this._safetyLock = { locked: false, reason: '', updatedAt: new Date().toISOString() };
  }

  // ── Connectors ──
  async createConnector(row) { this._connectors.set(row.id, { ...row }); return { ...row }; }
  async getConnector(id) { const c = this._connectors.get(id); return c ? { ...c } : null; }
  async listConnectors() { return [...this._connectors.values()].map((c) => ({ ...c })); }

  // ── Specs ──
  async createSpec(row) { this._specs.set(row.id, { ...row }); return { ...row }; }
  async getSpec(id) { const s = this._specs.get(id); return s ? { ...s } : null; }
  async findSpecByHash(hash) {
    for (const s of this._specs.values()) if (s.specHash === hash) return { ...s };
    return null;
  }

  // ── Runs ──
  async createRun(row) { this._runs.set(row.id, { ...row }); return { ...row }; }

  async updateRun(row) {
    if (!this._runs.has(row.id)) throw new Error(`Run ${row.id} existiert nicht`);
    // Single-flight: höchstens EIN aktiver Run global.
    if (ACTIVE_STATUSES.has(row.status)) {
      for (const r of this._runs.values()) {
        if (r.id !== row.id && ACTIVE_STATUSES.has(r.status)) {
          throw conflict('ACTIVE_RUN_CONFLICT', 'es läuft bereits ein aktiver Deploy-Run');
        }
      }
    }
    // Replay: höchstens EIN deployed Run je Spec.
    if (row.status === 'deployed') {
      for (const r of this._runs.values()) {
        if (r.id !== row.id && r.specId === row.specId && r.status === 'deployed') {
          throw conflict('DEPLOYED_CONFLICT', 'diese Spec wurde bereits deployt');
        }
      }
    }
    this._runs.set(row.id, { ...row });
    return { ...row };
  }

  async getRun(id) { const r = this._runs.get(id); return r ? { ...r } : null; }

  async findActiveRun() {
    for (const r of this._runs.values()) if (ACTIVE_STATUSES.has(r.status)) return { ...r };
    return null;
  }

  async findDeployedRunBySpec(specId) {
    for (const r of this._runs.values()) if (r.specId === specId && r.status === 'deployed') return { ...r };
    return null;
  }

  // ── Steps (append-only) ──
  async appendRunStep(row) { this._steps.push({ ...row }); return { ...row }; }
  async listRunSteps(runId) { return this._steps.filter((s) => s.runId === runId).map((s) => ({ ...s })); }

  // ── Audit (append-only) ──
  async appendDeployAudit(row) { this._audit.push({ ...row }); return { ...row }; }
  async listDeployAudit() { return this._audit.map((a) => ({ ...a })); }

  // ── Safety-Lock ──
  async getSafetyLock() { return { ...this._safetyLock }; }
  async setSafetyLock(locked, reason = '') {
    this._safetyLock = { locked: Boolean(locked), reason: String(reason || ''), updatedAt: new Date().toISOString() };
    return { ...this._safetyLock };
  }
}

module.exports = { InMemoryDeployRepository };
