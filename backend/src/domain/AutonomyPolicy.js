'use strict';

/**
 * AutonomyPolicy — Domain-Modell
 *
 * Repräsentiert die Konfiguration eines autonomen Aktions-Gates.
 * KRITISCH: Dieses Modell ist inert — es konfiguriert nur das Gate.
 * Nichts ist scharfgeschaltet. AUTONOMY_ENABLED Default = false.
 *
 * ADR-016: Autonomie-Fundament, Default-Advisory, Default-Deny.
 */

const { randomUUID } = require('crypto');

// ─── Enums ────────────────────────────────────────────────────────────────────

const ACTION_CLASSES = [
  'enrichment',        // TI-Lookup anhängen, Entities normalisieren — reversibel, additiv
  'internal_state',    // evidenzgestützter FP intern schließen, Tag setzen — intern reversibel
  'draft_generation',  // Report-/Entwurf erzeugen (kein Versand) — nur Text
  'detection_write',   // Wazuh-FP-Regel schreiben + Restart — bedingt reversibel
  'host_response',     // Host-Isolation, Block — personenwirksam, human-only
  'external_comms',    // Mail/Ticket an Kunden — nicht reversibel, human-only
];

const MODES = ['advisory', 'assisted', 'autonomous'];

// Rang: needs_more_info=0, false_positive=0, suspicious=1, confirmed_incident=2
// Konsistent zu OllamaLlmProvider.js VERDICT_RANK
const VERDICTS = ['needs_more_info', 'false_positive', 'suspicious', 'confirmed_incident'];

// ─── Harte Decken (nicht überschreibbar per Policy) ──────────────────────────
//
// Legt den höchsten zulässigen Autonomie-Modus je Aktionsklasse fest.
// Eine Policy kann ihre Decke NIE überschreiten — egal wie sie konfiguriert ist.
//
//   host_response  → advisory  (human-only, personenwirksam)
//   external_comms → advisory  (human-only, nicht reversibel)
//   detection_write→ assisted  (ADR-011/015: Vier-Augen bleibt)
//   enrichment     → autonomous (risikoarm, additiv, reversibel)
//   internal_state → autonomous (intern reversibel)
//   draft_generation→ autonomous (nur Text, kein Versand)

const CEILINGS = {
  enrichment:       'autonomous',
  internal_state:   'autonomous',
  draft_generation: 'autonomous',
  detection_write:  'assisted',
  host_response:    'advisory',
  external_comms:   'advisory',
};

// ─── Intern: Rang-Mapping ─────────────────────────────────────────────────────

const VERDICT_RANK = {
  needs_more_info:    0,
  false_positive:     0,
  suspicious:         1,
  confirmed_incident: 2,
};

const MODE_RANK = { advisory: 0, assisted: 1, autonomous: 2 };

// ─── Validierung (fail-fast) ──────────────────────────────────────────────────

function _validateCreate(data) {
  if (!ACTION_CLASSES.includes(data.actionClass)) {
    throw Object.assign(
      new Error(`Ungültige actionClass: '${data.actionClass}'. Erlaubt: ${ACTION_CLASSES.join(', ')}`),
      { status: 400 }
    );
  }
  const mode = data.mode ?? 'advisory';
  if (!MODES.includes(mode)) {
    throw Object.assign(
      new Error(`Ungültiger mode: '${mode}'. Erlaubt: ${MODES.join(', ')}`),
      { status: 400 }
    );
  }
  const minVerdict = data.minVerdict ?? 'confirmed_incident';
  if (!VERDICTS.includes(minVerdict)) {
    throw Object.assign(
      new Error(`Ungültiges minVerdict: '${minVerdict}'. Erlaubt: ${VERDICTS.join(', ')}`),
      { status: 400 }
    );
  }
  const minConfidence = data.minConfidence ?? 0.9;
  if (typeof minConfidence === 'number' && (minConfidence < 0 || minConfidence > 1)) {
    throw Object.assign(
      new Error(`minConfidence muss im Bereich [0, 1] liegen, war: ${minConfidence}`),
      { status: 400 }
    );
  }
  const maxPerHour = data.maxPerHour ?? 0;
  if (typeof maxPerHour === 'number' && maxPerHour < 0) {
    throw Object.assign(
      new Error(`maxPerHour muss >= 0 sein, war: ${maxPerHour}`),
      { status: 400 }
    );
  }
}

// ─── Domain-Klasse ────────────────────────────────────────────────────────────

class AutonomyPolicy {
  constructor({
    id                  = randomUUID(),
    customer            = '*',
    actionClass,
    mode                = 'advisory',
    minVerdict          = 'confirmed_incident',
    minConfidence       = 0.9,
    requireEvidenceFloor = true,
    maxPerHour          = 0,
    enabled             = false,
    createdBy           = '',
    createdAt           = new Date().toISOString(),
    updatedAt           = new Date().toISOString(),
  } = {}) {
    this.id                   = id;
    this.customer             = String(customer || '*');
    this.actionClass          = actionClass;
    this.mode                 = mode;
    this.minVerdict           = minVerdict;
    this.minConfidence        = typeof minConfidence === 'number' ? minConfidence : 0.9;
    this.requireEvidenceFloor = requireEvidenceFloor !== false;
    this.maxPerHour           = typeof maxPerHour === 'number' ? Math.max(0, Math.floor(maxPerHour)) : 0;
    this.enabled              = Boolean(enabled);
    this.createdBy            = String(createdBy || '');
    this.createdAt            = createdAt;
    this.updatedAt            = updatedAt;
  }

  // ─── Factory ──────────────────────────────────────────────────────────────

  static create(data = {}) {
    _validateCreate(data);
    const now = new Date().toISOString();
    return new AutonomyPolicy({ ...data, id: randomUUID(), createdAt: now, updatedAt: now });
  }

  // ─── Update (partiell, Whitelist, immutable-Stil) ─────────────────────────

  update(patch = {}) {
    const allowed = [
      'customer', 'mode', 'minVerdict', 'minConfidence',
      'requireEvidenceFloor', 'maxPerHour', 'enabled', 'createdBy',
    ];

    // Validierung des Patches bevor ein neues Objekt gebaut wird
    const merged = {};
    allowed.forEach((k) => {
      merged[k] = patch[k] !== undefined ? patch[k] : this[k];
    });

    // Validierung der veränderten Felder
    if (patch.mode !== undefined && !MODES.includes(patch.mode)) {
      throw Object.assign(
        new Error(`Ungültiger mode: '${patch.mode}'. Erlaubt: ${MODES.join(', ')}`),
        { status: 400 }
      );
    }
    if (patch.minVerdict !== undefined && !VERDICTS.includes(patch.minVerdict)) {
      throw Object.assign(
        new Error(`Ungültiges minVerdict: '${patch.minVerdict}'. Erlaubt: ${VERDICTS.join(', ')}`),
        { status: 400 }
      );
    }
    if (patch.minConfidence !== undefined && (patch.minConfidence < 0 || patch.minConfidence > 1)) {
      throw Object.assign(
        new Error(`minConfidence muss im Bereich [0, 1] liegen`),
        { status: 400 }
      );
    }
    if (patch.maxPerHour !== undefined && patch.maxPerHour < 0) {
      throw Object.assign(
        new Error(`maxPerHour muss >= 0 sein`),
        { status: 400 }
      );
    }

    // Neues Objekt (immutable-Stil — Original bleibt unverändert)
    return new AutonomyPolicy({
      ...this.toJSON(),
      ...merged,
      updatedAt: new Date().toISOString(),
    });
  }

  // ─── Serialisierung ───────────────────────────────────────────────────────

  toJSON() {
    return {
      id:                   this.id,
      customer:             this.customer,
      actionClass:          this.actionClass,
      mode:                 this.mode,
      minVerdict:           this.minVerdict,
      minConfidence:        this.minConfidence,
      requireEvidenceFloor: this.requireEvidenceFloor,
      maxPerHour:           this.maxPerHour,
      enabled:              this.enabled,
      createdBy:            this.createdBy,
      createdAt:            this.createdAt,
      updatedAt:            this.updatedAt,
    };
  }
}

module.exports = {
  AutonomyPolicy,
  ACTION_CLASSES,
  MODES,
  VERDICTS,
  CEILINGS,
  VERDICT_RANK,
  MODE_RANK,
};
