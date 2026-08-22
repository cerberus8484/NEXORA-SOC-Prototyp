'use strict';

// P_CORR_ADMIN_2 Stufe 2 — InMemory-Apply-Repo (Dev/Test, flüchtig). Gleicher
// öffentlicher Vertrag wie PostgresApplyRepository. Setzt die DB-Backstops als
// Code durch: Single-flight (höchstens EIN aktiver Run), Replay-Schutz (höchstens
// EIN applied Run je Plan), versionierter Store mit 1 aktiver Zeile je Key.

const ACTIVE_RUN_STATES = new Set(['applying', 'reloading', 'rolling_back']);

function conflict(code, message) { const e = new Error(message); e.code = code; return e; }

class InMemoryApplyRepository {
  constructor() {
    this._plans = new Map();      // id → planJson
    this._runs = new Map();       // id → runJson
    this._runtime = [];           // versionierte Config-Zeilen
    this._audit = [];             // append-only
    this._lock = { id: 'global', locked: false, reason: '', updatedAt: new Date().toISOString() };
  }

  // ── Plans ──
  async createPlan(json) { this._plans.set(json.id, { ...json }); return { ...json }; }
  async findPlanById(id) { const p = this._plans.get(id); return p ? { ...p } : null; }
  async findPlanByHash(hash) { for (const p of this._plans.values()) if (p.planHash === hash) return { ...p }; return null; }

  // ── Runs (Single-flight + Replay) ──
  async createRun(json) {
    for (const r of this._runs.values()) {
      if (ACTIVE_RUN_STATES.has(r.status)) throw conflict('ACTIVE_RUN_CONFLICT', 'es läuft bereits ein Apply-Run');
      if (r.planId === json.planId && r.status === 'applied') throw conflict('PLAN_ALREADY_APPLIED', 'Plan wurde bereits angewendet');
    }
    this._runs.set(json.id, { ...json });
    return { ...json };
  }
  async updateRun(json) { if (!this._runs.has(json.id)) return null; this._runs.set(json.id, { ...json }); return { ...json }; }
  async findRunById(id) { const r = this._runs.get(id); return r ? { ...r } : null; }
  async findActiveRun() { for (const r of this._runs.values()) if (ACTIVE_RUN_STATES.has(r.status)) return { ...r }; return null; }
  async findAppliedRunByPlan(planId) { for (const r of this._runs.values()) if (r.planId === planId && r.status === 'applied') return { ...r }; return null; }

  // ── Runtime-Config-Store (versioniert) ──
  async getActiveRuntimeConfig(capabilityId, targetId) {
    const rows = this._runtime.filter((r) => r.capabilityId === capabilityId && r.targetId === targetId && r.active);
    return rows.length ? { ...rows[rows.length - 1] } : null;
  }
  async _maxVersion(capabilityId, targetId) {
    let max = 0;
    for (const r of this._runtime) if (r.capabilityId === capabilityId && r.targetId === targetId) max = Math.max(max, r.version);
    return max;
  }
  async writeRuntimeConfig({ capabilityId, targetId, value, appliedBy = '' }) {
    for (const r of this._runtime) if (r.capabilityId === capabilityId && r.targetId === targetId) r.active = false;
    const version = (await this._maxVersion(capabilityId, targetId)) + 1;
    const row = { id: `${capabilityId}:${targetId}:${version}`, capabilityId, targetId, value, version, appliedBy, active: true, createdAt: new Date().toISOString() };
    this._runtime.push(row);
    return { ...row };
  }

  // ── Audit (append-only) + Safety-Lock ──
  async appendApplyAudit(json) { this._audit.push({ ...json }); return { ...json }; }
  async listApplyAudit(filter = {}) {
    let arr = [...this._audit];
    if (filter.runId) arr = arr.filter((a) => a.runId === filter.runId);
    if (filter.planId) arr = arr.filter((a) => a.planId === filter.planId);
    return arr.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest first
  }
  async getSafetyLock() { return { ...this._lock }; }
  async setSafetyLock(locked, reason = '') { this._lock = { id: 'global', locked: !!locked, reason: String(reason || ''), updatedAt: new Date().toISOString() }; return { ...this._lock }; }
}

module.exports = { InMemoryApplyRepository, ACTIVE_RUN_STATES };
