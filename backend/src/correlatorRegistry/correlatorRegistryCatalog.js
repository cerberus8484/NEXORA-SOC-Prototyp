'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_1 — Correlator Registry (Code-Allowlist, Slice 1).
//
// KEINE generische Correlator-Engine, KEIN dynamisches Laden/Ausführen von
// Correlator-Code. Nur exakt die hier gelisteten, bekannten Correlatoren sind
// administrierbar. Unbekannter Correlator = deny.
//
// Gebundene Konfigurations-Capabilities sind ein Schnitt zweier Allowlists:
// sie müssen sowohl hier (am Correlator) als auch im P_CONFIG_1-Catalog real
// existieren. Beim Modul-Load wird das fail-fast geprüft (kein toter Verweis).
//
// In Slice 1: KEIN Apply/Restart/Reload. Genehmigte Config bleibt approved,
// not applied. Dieser Katalog beschreibt NUR Stammdaten — keine Laufzeitlogik.
// ─────────────────────────────────────────────────────────────────────────

const { AppError } = require('../errors/AppError');
const { CORRELATION_ENGINE_VERSION } = require('../correlation/correlationJobDomain');
const { getCapability } = require('../configRegistry/configCapabilityCatalog');

const RISK_CLASSES = ['low', 'medium', 'high'];

// AppError → der zentrale errorHandler mappt statusCode; .status zusätzlich für
// Domain-/Unit-Tests (toMatchObject({ status })), konsistent zum Config-Catalog.
const CODE_BY_STATUS = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
function err(message, status = 400) {
  const e = new AppError(message, status, CODE_BY_STATUS[status] || 'CORRELATOR_ERROR');
  e.status = status;
  return e;
}

// Der eine reale Correlator heute: die asynchrone CorrelationEngine/-Worker-Pipeline.
const REAL_CORRELATOR_ID = 'correlation-worker';

// ─── Die Correlator-Allowlist ───────────────────────────────────────────────
// `configTargetId` verweist auf die P_CONFIG_1-Zielinstanz (Allowlist dort),
// `configCapabilityIds` auf die dort real existierenden, gebundenen Capabilities.
const CATALOG = [
  {
    id: REAL_CORRELATOR_ID,
    name: 'Correlation Engine',
    description:
      'Asynchrone, materialisierte Korrelation: Ticket/Evidence/Flow geändert → persistenter '
      + 'Correlation-Job → Worker → materialisiertes Result, das die UI nur liest. '
      + 'Kein SIEM-/EDR-Ersatz, keine Bedrohungsentfernung.',
    engineVersion: CORRELATION_ENGINE_VERSION, // 'ce-1' — Quelle der Wahrheit ist die Domain
    riskClass: 'medium',                        // operative Klassifizierung (Korrelation steuert Triage-Sicht)
    inputSources: ['ticket', 'child-ticket', 'evidence'],
    outputTypes: ['correlated-evidence'],       // correlation_results.result (materialisiert)
    configTargetId: 'correlation-worker',
    configCapabilityIds: ['correlator.worker.maxChildren', 'correlator.worker.maxRetries'],
  },
];

// ─── CorrelatorDefinition — read-only Sicht auf einen Allowlist-Eintrag ──────
class CorrelatorDefinition {
  constructor(def) { this._def = def; }
  get id() { return this._def.id; }
  get name() { return this._def.name; }
  get description() { return this._def.description; }
  get engineVersion() { return this._def.engineVersion; }
  get riskClass() { return this._def.riskClass; }
  get configTargetId() { return this._def.configTargetId; }
  get configCapabilityIds() { return [...this._def.configCapabilityIds]; }
  get inputSources() { return [...this._def.inputSources]; }
  get outputTypes() { return [...this._def.outputTypes]; }

  /** True, wenn `capabilityId` an genau diesen Correlator gebunden ist. */
  hasCapability(capabilityId) { return this._def.configCapabilityIds.includes(capabilityId); }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this._def.description,
      engineVersion: this.engineVersion,
      riskClass: this.riskClass,
      inputSources: this.inputSources,
      outputTypes: this.outputTypes,
      configTargetId: this.configTargetId,
      configCapabilityIds: this.configCapabilityIds,
    };
  }
}

const CATALOG_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

// Fail-fast beim Modul-Load: jede gebundene Capability MUSS real im P_CONFIG_1-Catalog
// existieren und zum Correlator-Ziel passen. Kein toter/falscher Verweis im Betrieb.
for (const def of CATALOG) {
  for (const capId of def.configCapabilityIds) {
    const cap = getCapability(capId); // wirft, wenn unbekannt
    if (!cap.allowedTargets.includes(def.configTargetId)) {
      throw new Error(
        `correlatorRegistryCatalog: Capability '${capId}' ist nicht für Ziel '${def.configTargetId}' erlaubt`,
      );
    }
  }
}

// ─── Allowlist-Zugriff (unknown = deny) ─────────────────────────────────────
function listCorrelators() { return CATALOG.map((def) => new CorrelatorDefinition(def)); }

function getCorrelator(id) {
  const def = CATALOG_BY_ID.get(id);
  if (!def) throw err(`unbekannter Correlator: '${id}' — nicht in der Allowlist`, 404);
  return new CorrelatorDefinition(def);
}

/** Erzwingt: capability ∈ correlator.configCapabilityIds. Nicht gebunden = 400 deny. */
function assertCapabilityBound(correlator, capabilityId) {
  if (!correlator || typeof correlator.hasCapability !== 'function') {
    throw err('assertCapabilityBound: ungültiger Correlator', 400);
  }
  if (!correlator.hasCapability(capabilityId)) {
    throw err(`Capability '${capabilityId}' ist nicht an Correlator '${correlator.id}' gebunden`, 400);
  }
}

module.exports = {
  RISK_CLASSES, REAL_CORRELATOR_ID,
  CorrelatorDefinition,
  listCorrelators, getCorrelator, assertCapabilityBound, err,
};
