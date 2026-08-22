'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 2 — Apply-Domain (rein, keine DB/HTTP/Ausführung).
//
//   ApplyPlan  — immutabler, gehashter Snapshot eines genehmigten Drafts.
//   ApplyRun   — ein Ausführungsversuch mit fail-closed State-Machine:
//                applying → reloading → applied
//                          ↘ rolling_back → rolled_back
//                                          ↘ failed_safe_stop
//   RuntimeConfigVersion — eine versionierte Zeile im Runtime-Config-Store.
//
// Es gibt KEINE Methode, die etwas anwendet/schreibt/neustartet — das macht der
// ApplyExecutor mit injizierten Adaptern. Hier nur Zustand + Übergänge.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

// Stabiler kanonischer String (Schlüssel rekursiv sortiert) → deterministischer Hash.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** Deterministischer Plan-Hash über kanonische {cap,target,value,expectedVersion}. */
function computePlanHash({ capabilityId, targetId, value, expectedVersion } = {}) {
  const c = canonical({ c: capabilityId, t: targetId, v: value ?? {}, e: Number(expectedVersion) });
  return crypto.createHash('sha256').update(c).digest('hex');
}

class ApplyPlan {
  constructor({ id = crypto.randomUUID(), draftId, capabilityId, targetId, value = {}, planHash, expectedVersion, createdBy = '', createdAt = new Date().toISOString() } = {}) {
    this.id = id; this.draftId = draftId; this.capabilityId = capabilityId; this.targetId = targetId;
    this.value = value; this.planHash = planHash; this.expectedVersion = expectedVersion;
    this.createdBy = String(createdBy || ''); this.createdAt = createdAt;
    // Bewusst KEINE apply()/mutate()/setValue()/update()-Methode — immutabel.
  }
  static create({ draftId, capabilityId, targetId, value, expectedVersion, createdBy } = {}) {
    if (!draftId) throw new Error('ApplyPlan.create: draftId fehlt');
    if (!capabilityId) throw new Error('ApplyPlan.create: capabilityId fehlt');
    if (!targetId) throw new Error('ApplyPlan.create: targetId fehlt');
    if (!Number.isInteger(expectedVersion)) throw new Error('ApplyPlan.create: expectedVersion (int) fehlt');
    const planHash = computePlanHash({ capabilityId, targetId, value: value ?? {}, expectedVersion });
    return new ApplyPlan({ id: crypto.randomUUID(), draftId, capabilityId, targetId, value: value ?? {}, planHash, expectedVersion, createdBy, createdAt: new Date().toISOString() });
  }
  toJSON() {
    return { id: this.id, draftId: this.draftId, capabilityId: this.capabilityId, targetId: this.targetId, value: this.value, planHash: this.planHash, expectedVersion: this.expectedVersion, createdBy: this.createdBy, createdAt: this.createdAt };
  }
}

const APPLY_RUN_STATUS = Object.freeze({
  APPLYING: 'applying',
  RELOADING: 'reloading',
  APPLIED: 'applied',
  ROLLING_BACK: 'rolling_back',
  ROLLED_BACK: 'rolled_back',
  FAILED_SAFE_STOP: 'failed_safe_stop',
});

const TERMINAL = new Set([APPLY_RUN_STATUS.APPLIED, APPLY_RUN_STATUS.ROLLED_BACK, APPLY_RUN_STATUS.FAILED_SAFE_STOP]);

const TRANSITIONS = Object.freeze({
  [APPLY_RUN_STATUS.APPLYING]:     new Set([APPLY_RUN_STATUS.RELOADING, APPLY_RUN_STATUS.ROLLING_BACK]),
  [APPLY_RUN_STATUS.RELOADING]:    new Set([APPLY_RUN_STATUS.APPLIED, APPLY_RUN_STATUS.ROLLING_BACK]),
  [APPLY_RUN_STATUS.ROLLING_BACK]: new Set([APPLY_RUN_STATUS.ROLLED_BACK, APPLY_RUN_STATUS.FAILED_SAFE_STOP]),
  [APPLY_RUN_STATUS.APPLIED]:      new Set(),
  [APPLY_RUN_STATUS.ROLLED_BACK]:  new Set(),
  [APPLY_RUN_STATUS.FAILED_SAFE_STOP]: new Set(),
});

class ApplyRun {
  constructor({ id = crypto.randomUUID(), planId, status = APPLY_RUN_STATUS.APPLYING, startedBy = '', startedAt = new Date().toISOString(), finishedAt = null, configVersion = null, health = null, failureReason = null } = {}) {
    this.id = id; this.planId = planId; this.status = status; this.startedBy = String(startedBy || '');
    this.startedAt = startedAt; this.finishedAt = finishedAt; this.configVersion = configVersion;
    this.health = health; this.failureReason = failureReason;
  }
  static start({ planId, startedBy } = {}) {
    if (!planId) throw new Error('ApplyRun.start: planId fehlt');
    return new ApplyRun({ id: crypto.randomUUID(), planId, status: APPLY_RUN_STATUS.APPLYING, startedBy, startedAt: new Date().toISOString() });
  }
  isTerminal() { return TERMINAL.has(this.status); }
  _to(next) {
    const allowed = TRANSITIONS[this.status];
    if (!allowed || !allowed.has(next)) throw new Error(`Ungültiger Apply-Run-Übergang: ${this.status} → ${next}`);
    this.status = next;
  }
  toReloading(configVersion) { this._to(APPLY_RUN_STATUS.RELOADING); this.configVersion = configVersion; return this; }
  toApplied(health) { this._to(APPLY_RUN_STATUS.APPLIED); this.health = health ?? null; this.finishedAt = new Date().toISOString(); return this; }
  toRollingBack(reason) { this._to(APPLY_RUN_STATUS.ROLLING_BACK); this.failureReason = reason || this.failureReason || 'unbekannt'; return this; }
  toRolledBack() { this._to(APPLY_RUN_STATUS.ROLLED_BACK); this.finishedAt = new Date().toISOString(); return this; }
  toFailedSafeStop(reason) { this._to(APPLY_RUN_STATUS.FAILED_SAFE_STOP); this.failureReason = reason || this.failureReason || 'unbekannt'; this.finishedAt = new Date().toISOString(); return this; }
  toJSON() {
    return { id: this.id, planId: this.planId, status: this.status, startedBy: this.startedBy, startedAt: this.startedAt, finishedAt: this.finishedAt, configVersion: this.configVersion, health: this.health, failureReason: this.failureReason };
  }
}

class RuntimeConfigVersion {
  constructor({ id = crypto.randomUUID(), capabilityId, targetId, value = {}, version, appliedBy = '', active = true, createdAt = new Date().toISOString() } = {}) {
    this.id = id; this.capabilityId = capabilityId; this.targetId = targetId; this.value = value;
    this.version = version; this.appliedBy = String(appliedBy || ''); this.active = active; this.createdAt = createdAt;
  }
  toJSON() {
    return { id: this.id, capabilityId: this.capabilityId, targetId: this.targetId, value: this.value, version: this.version, appliedBy: this.appliedBy, active: this.active, createdAt: this.createdAt };
  }
}

module.exports = { ApplyPlan, ApplyRun, RuntimeConfigVersion, APPLY_RUN_STATUS, TERMINAL, computePlanHash, canonical };
