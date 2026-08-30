'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Deploy-Domain (rein, keine DB/HTTP/Ausführung).
//
//   DeploySpec — immutabler, gehashter Deploy-Wunsch (Modul/Connector/Netz/Params).
//                Der Spec-Hash ist deterministisch + kanonisch und schließt Secrets
//                (adminPassword …) defensiv aus. Der Spec persistiert NIE ein Secret.
//   DeployRun  — Lifecycle-State-Machine (fail-closed):
//                planned → approved → applying → cloning → starting → configuring
//                        → verifying → deployed
//                        ↘ rolling_back → rolled_back
//                                        ↘ failed_safe_stop
//
// Es gibt KEINE Methode, die etwas klont/schreibt/startet — das macht der
// DeployOrchestrator (Phase 4) mit injizierten Connectoren. Hier nur Zustand.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { AppError } = require('../errors/AppError');

// Secret-Schlüssel, die NIE persistiert/gehasht werden dürfen.
const SECRET_KEY = /(password|secret|token|api[_-]?key|apikey|privatekey|private_key|bearer|credential|passphrase)/i;

// AppError → der zentrale errorHandler mappt statusCode+code (plain Error würde 500);
// .status zusätzlich für Domain-/Unit-Tests (toMatchObject({ status })).
const CODE_BY_STATUS = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
function err(message, status = 400) {
  const e = new AppError(message, status, CODE_BY_STATUS[status] || 'DEPLOY_ERROR');
  e.status = status;
  return e;
}

function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw err(`${field} fehlt oder ist leer`);
}

// Rekursiver Fail-fast: kein Secret-Schlüssel im Objekt (keine Klartext-Credentials im Spec).
function assertNoSecrets(value, path = '') {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`)); return; }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (SECRET_KEY.test(k)) throw err(`Secret-Feld nicht erlaubt im Deploy-Spec: '${path}${k}' (write-only, nie persistieren)`);
      assertNoSecrets(value[k], `${path}${k}.`);
    }
  }
}

// Tiefe Kopie ohne Secret-Schlüssel (defensiv fürs Hashing, falls doch eins durchrutscht).
function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = stripSecrets(value[k]);
    }
    return out;
  }
  return value;
}

// Stabiler kanonischer String (Schlüssel rekursiv sortiert) → deterministischer Hash.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** Deterministischer Spec-Hash über kanonisch + secret-gestrippt. */
function computeSpecHash(input = {}) {
  return crypto.createHash('sha256').update(canonical(stripSecrets(input))).digest('hex');
}

class DeploySpec {
  constructor({
    id = crypto.randomUUID(), moduleId, connectorId, targetNode, storage, bridge,
    resources = {}, params = {}, specHash, createdBy = '', createdAt = new Date().toISOString(),
  } = {}) {
    this.id = id; this.moduleId = moduleId; this.connectorId = connectorId;
    this.targetNode = targetNode; this.storage = storage; this.bridge = bridge;
    this.resources = resources; this.params = params; this.specHash = specHash;
    this.createdBy = String(createdBy || ''); this.createdAt = createdAt;
    // Bewusst KEINE apply()/mutate()/setParams()/update()-Methode — immutabel.
  }

  // requirePlacement=true (Default) = vm-clone: Ziel-Node/Storage/Bridge sind Pflicht.
  // agent-install (Brownfield, bestehender Host) kennt kein Proxmox-Placement → false.
  static create({ moduleId, connectorId, targetNode, storage, bridge, resources, params, createdBy } = {}, { requirePlacement = true } = {}) {
    assertNonEmpty(moduleId, 'moduleId');
    assertNonEmpty(connectorId, 'connectorId');
    if (requirePlacement) {
      assertNonEmpty(targetNode, 'targetNode');
      assertNonEmpty(storage, 'storage');
      assertNonEmpty(bridge, 'bridge');
    }
    const res = resources && typeof resources === 'object' ? resources : {};
    const par = params && typeof params === 'object' ? params : {};
    assertNoSecrets(par, 'params.'); // write-only Secrets (adminPassword) gehören NICHT in den Spec
    const core = { moduleId, connectorId, targetNode, storage, bridge, resources: res, params: par };
    const specHash = computeSpecHash(core);
    return new DeploySpec({ id: crypto.randomUUID(), ...core, specHash, createdBy, createdAt: new Date().toISOString() });
  }

  toJSON() {
    return {
      id: this.id, moduleId: this.moduleId, connectorId: this.connectorId,
      targetNode: this.targetNode, storage: this.storage, bridge: this.bridge,
      resources: this.resources, params: this.params, specHash: this.specHash,
      createdBy: this.createdBy, createdAt: this.createdAt,
    };
  }
}

const DEPLOY_RUN_STATUS = Object.freeze({
  PLANNED: 'planned',
  APPROVED: 'approved',
  APPLYING: 'applying',
  CLONING: 'cloning',
  STARTING: 'starting',
  CONFIGURING: 'configuring',
  VERIFYING: 'verifying',
  DEPLOYED: 'deployed',
  ROLLING_BACK: 'rolling_back',
  ROLLED_BACK: 'rolled_back',
  FAILED_SAFE_STOP: 'failed_safe_stop',
});

const TERMINAL = new Set([
  DEPLOY_RUN_STATUS.DEPLOYED, DEPLOY_RUN_STATUS.ROLLED_BACK, DEPLOY_RUN_STATUS.FAILED_SAFE_STOP,
]);

// Ausführungsschritte, aus denen bei Fehler in den Rollback verzweigt werden darf.
const ACTIVE_STEPS = [
  DEPLOY_RUN_STATUS.APPLYING, DEPLOY_RUN_STATUS.CLONING, DEPLOY_RUN_STATUS.STARTING,
  DEPLOY_RUN_STATUS.CONFIGURING, DEPLOY_RUN_STATUS.VERIFYING,
];

const TRANSITIONS = Object.freeze({
  [DEPLOY_RUN_STATUS.PLANNED]:      new Set([DEPLOY_RUN_STATUS.APPROVED]),
  [DEPLOY_RUN_STATUS.APPROVED]:     new Set([DEPLOY_RUN_STATUS.APPLYING]),
  // CLONING = vm-clone-Pfad · DEPLOYED = agent-install-Pfad (atomarer Remote-Install,
  // kein clone/start/verify) · ROLLING_BACK = Fehler in beiden Pfaden.
  [DEPLOY_RUN_STATUS.APPLYING]:     new Set([DEPLOY_RUN_STATUS.CLONING, DEPLOY_RUN_STATUS.DEPLOYED, DEPLOY_RUN_STATUS.ROLLING_BACK]),
  [DEPLOY_RUN_STATUS.CLONING]:      new Set([DEPLOY_RUN_STATUS.STARTING, DEPLOY_RUN_STATUS.ROLLING_BACK]),
  [DEPLOY_RUN_STATUS.STARTING]:     new Set([DEPLOY_RUN_STATUS.CONFIGURING, DEPLOY_RUN_STATUS.ROLLING_BACK]),
  [DEPLOY_RUN_STATUS.CONFIGURING]:  new Set([DEPLOY_RUN_STATUS.VERIFYING, DEPLOY_RUN_STATUS.ROLLING_BACK]),
  [DEPLOY_RUN_STATUS.VERIFYING]:    new Set([DEPLOY_RUN_STATUS.DEPLOYED, DEPLOY_RUN_STATUS.ROLLING_BACK]),
  [DEPLOY_RUN_STATUS.ROLLING_BACK]: new Set([DEPLOY_RUN_STATUS.ROLLED_BACK, DEPLOY_RUN_STATUS.FAILED_SAFE_STOP]),
  [DEPLOY_RUN_STATUS.DEPLOYED]:      new Set(),
  [DEPLOY_RUN_STATUS.ROLLED_BACK]:   new Set(),
  [DEPLOY_RUN_STATUS.FAILED_SAFE_STOP]: new Set(),
});

class DeployRun {
  constructor({
    id = crypto.randomUUID(), specId, status = DEPLOY_RUN_STATUS.PLANNED, startedBy = '', startedById = null,
    approvedBy = null, approvedById = null, vmid = null, startedAt = new Date().toISOString(),
    approvedAt = null, finishedAt = null, failureReason = null,
  } = {}) {
    this.id = id; this.specId = specId; this.status = status; this.startedBy = String(startedBy || '');
    this.startedById = startedById; this.approvedBy = approvedBy; this.approvedById = approvedById;
    this.vmid = vmid; this.startedAt = startedAt;
    this.approvedAt = approvedAt; this.finishedAt = finishedAt; this.failureReason = failureReason;
  }

  static plan({ specId, startedBy, startedById } = {}) {
    if (!specId) throw err('DeployRun.plan: specId fehlt');
    return new DeployRun({ id: crypto.randomUUID(), specId, status: DEPLOY_RUN_STATUS.PLANNED, startedBy, startedById: startedById || null, startedAt: new Date().toISOString() });
  }

  isTerminal() { return TERMINAL.has(this.status); }

  _to(next) {
    const allowed = TRANSITIONS[this.status];
    if (!allowed || !allowed.has(next)) throw err(`Ungültiger Deploy-Run-Übergang: ${this.status} → ${next}`);
    this.status = next;
  }

  setVmid(vmid) { this.vmid = vmid; return this; }

  toApproved(approvedBy, approvedById = null) {
    this._to(DEPLOY_RUN_STATUS.APPROVED);
    this.approvedBy = String(approvedBy || '');
    this.approvedById = approvedById || null;
    this.approvedAt = new Date().toISOString();
    return this;
  }
  toApplying()    { this._to(DEPLOY_RUN_STATUS.APPLYING); return this; }
  toCloning()     { this._to(DEPLOY_RUN_STATUS.CLONING); return this; }
  toStarting()    { this._to(DEPLOY_RUN_STATUS.STARTING); return this; }
  toConfiguring() { this._to(DEPLOY_RUN_STATUS.CONFIGURING); return this; }
  toVerifying()   { this._to(DEPLOY_RUN_STATUS.VERIFYING); return this; }
  toDeployed()    { this._to(DEPLOY_RUN_STATUS.DEPLOYED); this.finishedAt = new Date().toISOString(); return this; }
  toRollingBack(reason) {
    this._to(DEPLOY_RUN_STATUS.ROLLING_BACK);
    this.failureReason = reason || this.failureReason || 'unbekannt';
    return this;
  }
  toRolledBack() { this._to(DEPLOY_RUN_STATUS.ROLLED_BACK); this.finishedAt = new Date().toISOString(); return this; }
  toFailedSafeStop(reason) {
    this._to(DEPLOY_RUN_STATUS.FAILED_SAFE_STOP);
    this.failureReason = reason || this.failureReason || 'unbekannt';
    this.finishedAt = new Date().toISOString();
    return this;
  }

  toJSON() {
    return {
      id: this.id, specId: this.specId, status: this.status,
      startedBy: this.startedBy, startedById: this.startedById,
      approvedBy: this.approvedBy, approvedById: this.approvedById,
      vmid: this.vmid, startedAt: this.startedAt,
      approvedAt: this.approvedAt, finishedAt: this.finishedAt, failureReason: this.failureReason,
    };
  }
}

module.exports = {
  DeploySpec, DeployRun, DEPLOY_RUN_STATUS, TERMINAL, ACTIVE_STEPS, TRANSITIONS,
  computeSpecHash, canonical, stripSecrets, assertNoSecrets,
};
