'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CONFIG_1 — Configuration Capability Registry (Allowlist, Slice 1)
//
// KEIN generischer Key-Value-Store, KEIN Editor für beliebige Konfiguration.
// Nur exakt die hier gelisteten, typisierten Capabilities sind administrierbar.
// Unbekannte Capability = deny. Keine freien Keys, kein freies JSON, kein Pfad.
//
// In Slice 1: applyStatus IMMER 'not_supported' — kein Apply/Reload/Restart.
// host-/netznahe Capabilities sind höchstens als reservierte, NICHT editierbare
// Capability sichtbar.
// ─────────────────────────────────────────────────────────────────────────

const Joi = require('joi');
const { AppError } = require('../errors/AppError');
const config = require('../config');

// Globaler Kill-Switch (Server-/Deployment-Flag, Default false, NICHT UI-schaltbar).
function applyChannelEnabled() { return !!(config.apply && config.apply.enabled); }

const SCOPES = ['correlator', 'collector', 'integration', 'service', 'host'];
const RISK_CLASSES = ['low', 'medium', 'high', 'prohibited'];
const APPLY_IMPACTS = ['none', 'reload', 'restart'];
const APPLY_STATUS_NOT_SUPPORTED = 'not_supported';
const REDACTED = '***redacted***';

// AppError → der zentrale errorHandler mappt statusCode korrekt; .status zusätzlich
// für die Domain-/Unit-Tests (toMatchObject({ status })).
const CODE_BY_STATUS = { 400: 'BAD_REQUEST', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT' };
function err(message, status = 400) {
  const e = new AppError(message, status, CODE_BY_STATUS[status] || 'CONFIG_ERROR');
  e.status = status;
  return e;
}

// Schlüssel, die NIE als Klartext-Wert in einer Config stehen dürfen.
const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|apikey|privatekey|private_key|bearer|credential)/i;
function assertNoSecretKeys(value, path = '') {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoSecretKeys(v, `${path}[${i}]`)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) throw err(`Klartext-Secret nicht erlaubt: '${path ? `${path}.` : ''}${k}' — später nur Secret-Referenzen`);
    assertNoSecretKeys(v, path ? `${path}.${k}` : k);
  }
}

// ─── Erlaubte Zielinstanzen (Allowlist) ─────────────────────────────────────
const CONFIG_TARGETS = [
  { id: 'correlation-worker', scope: 'correlator',  label: 'Correlation Worker' },
  { id: 'firewall-collector', scope: 'collector',   label: 'Firewall Collector' },
  { id: 'virustotal',         scope: 'integration', label: 'VirusTotal Integration' },
  { id: 'notify',             scope: 'integration', label: 'Notification Channel' },
  { id: 'api',                scope: 'service',     label: 'API Service' },
  { id: 'host-fw',            scope: 'host',        label: 'Firewall Host (reserviert)' },
];

// ─── Die Capability-Allowlist ───────────────────────────────────────────────
// Nur sichere, klar eingegrenzte Limits. Eine host-/netznahe Capability ist
// bewusst NICHT editierbar (reserviert). Eine Capability trägt ein sensitives
// Feld (Referenz, kein Secret) zum Nachweis der Redaction.
const CATALOG = [
  {
    id: 'correlator.worker.maxChildren', scope: 'correlator', risk: 'low',
    schema: Joi.object({ maxChildren: Joi.number().integer().min(1).max(1000).default(200) }),
    allowedTargets: ['correlation-worker'],
    description: 'Maximale Anzahl Child-Tickets pro Correlation-Job.',
    effect: 'Begrenzt den Input pro Job (Schutz vor unbounded Evidence-Mengen).',
    applyImpact: 'reload', sensitiveFields: [], editable: true,
  },
  {
    id: 'correlator.worker.maxRetries', scope: 'correlator', risk: 'low',
    schema: Joi.object({ maxRetries: Joi.number().integer().min(1).max(10).default(3) }),
    allowedTargets: ['correlation-worker'],
    description: 'Maximale Wiederholungen eines Correlation-Jobs vor Dead-Letter.',
    effect: 'Bounded Retries; danach kontrollierte Verwerfung.',
    applyImpact: 'reload', sensitiveFields: [], editable: true,
  },
  {
    id: 'collector.firewall.maxLineBytes', scope: 'collector', risk: 'low',
    schema: Joi.object({ maxLineBytes: Joi.number().integer().min(256).max(1048576).default(8192) }),
    allowedTargets: ['firewall-collector'],
    description: 'Maximum line length in the firewall collector reader.',
    effect: 'Protects against oversized or malicious input lines (bounded memory).',
    applyImpact: 'restart', sensitiveFields: [], editable: true,
  },
  {
    id: 'collector.firewall.maxLinesPerSecond', scope: 'collector', risk: 'medium',
    schema: Joi.object({ maxLinesPerSecond: Joi.number().integer().min(0).max(1000000).default(0) }),
    allowedTargets: ['firewall-collector'],
    description: 'Lokale Eingangsraten-Begrenzung (0 = unbegrenzt).',
    effect: 'Drosselt die lokale Verarbeitungsrate.',
    applyImpact: 'reload', sensitiveFields: [], editable: true,
  },
  {
    id: 'integration.virustotal.pollIntervalSeconds', scope: 'integration', risk: 'low',
    schema: Joi.object({ intervalSeconds: Joi.number().integer().min(30).max(3600).default(300) }),
    allowedTargets: ['virustotal'],
    description: 'Query interval for VirusTotal enrichment.',
    effect: 'Controls request frequency to preserve quota and rate limits.',
    applyImpact: 'none', sensitiveFields: [], editable: true,
  },
  {
    id: 'integration.notify.targetRef', scope: 'integration', risk: 'medium',
    schema: Joi.object({ targetRef: Joi.string().pattern(/^[a-z]+:\/\/[\w./-]+$/).max(200).required() }),
    allowedTargets: ['notify'],
    description: 'Referenz auf das Benachrichtigungsziel (KEINE Klartext-Adresse/Secret).',
    effect: 'Routet Benachrichtigungen an das referenzierte Ziel.',
    applyImpact: 'none', sensitiveFields: ['targetRef'], editable: true,
  },
  {
    id: 'service.api.requestLogLevel', scope: 'service', risk: 'low',
    schema: Joi.object({ level: Joi.string().valid('info', 'warn', 'error').default('info') }),
    allowedTargets: ['api'],
    description: 'Log-Level der API-Request-Protokollierung.',
    effect: 'Steuert die Ausführlichkeit der Request-Logs.',
    applyImpact: 'reload', sensitiveFields: [], editable: true,
  },
  {
    id: 'host.network.allowlist', scope: 'host', risk: 'prohibited',
    schema: Joi.object({ cidrs: Joi.array().items(Joi.string().max(64)).max(50).default([]) }),
    allowedTargets: ['host-fw'],
    description: 'RESERVIERT — host-/netznahe Quell-Allowlist.',
    effect: 'Würde erlaubte Quell-Netze steuern (später, streng gated).',
    applyImpact: 'restart', sensitiveFields: [], editable: false, // nur sichtbar, nicht editierbar
  },
];

// ─── Apply-Eligibility (P_CORR_ADMIN_2) ─────────────────────────────────────
// EIGENE, engere Allowlist als die Editier-Allowlist: nur diese Capabilities
// DÜRFTEN überhaupt jemals (in einem späteren, separat gesicherten Schritt)
// angewendet werden. Host-/Netz-/Firewall-/Collector-nah bleibt ausgeschlossen.
// Eligibility ändert NICHTS am applyStatus — der bleibt in dieser Stufe
// ausnahmslos 'not_supported' (kein Apply/Reload/Restart).
const APPLY_ELIGIBLE_CAPABILITY_IDS = new Set([
  'correlator.worker.maxChildren',
  'correlator.worker.maxRetries',
]);
function isApplyEligible(id) { return APPLY_ELIGIBLE_CAPABILITY_IDS.has(id); }

const CATALOG_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
const TARGET_BY_ID = new Map(CONFIG_TARGETS.map((t) => [t.id, t]));

// ─── ConfigCapability — read-only Sicht auf einen Allowlist-Eintrag ──────────
class ConfigCapability {
  constructor(def) { this._def = def; }
  get id() { return this._def.id; }
  get scope() { return this._def.scope; }
  get risk() { return this._def.risk; }
  get editable() { return this._def.editable; }
  // 'supported' NUR wenn die Capability apply-eligible ist UND der globale Kill-Switch
  // (CONFIG_APPLY_ENABLED) an ist. Default-off → wie bisher 'not_supported'. Die
  // tatsächliche Apply-Durchführung ist zusätzlich durch Gates + Safety-Lock geschützt.
  get applyStatus() {
    return (this.applyEligible && applyChannelEnabled()) ? 'supported' : APPLY_STATUS_NOT_SUPPORTED;
  }
  get applyImpact() { return this._def.applyImpact; }
  get applyEligible() { return isApplyEligible(this.id); } // darf SPÄTER mal angewendet werden ≠ jetzt
  get sensitiveFields() { return [...this._def.sensitiveFields]; }
  get allowedTargets() { return [...this._def.allowedTargets]; }

  /** Validiert + füllt Defaults; lehnt unbekannte Keys + Klartext-Secrets ab. */
  validateValue(value) {
    assertNoSecretKeys(value, 'value');
    const { value: clean, error } = this._def.schema.validate(value ?? {}, { abortEarly: false, convert: true });
    if (error) throw err(`Schema-Validierung fehlgeschlagen für ${this.id}: ${error.message}`);
    return clean;
  }

  /** Nicht-werfende Validierung für den separaten Validierungsschritt (P_CORR_ADMIN_2).
   *  Gibt ein strukturiertes Ergebnis zurück statt zu werfen; Wert wird redigiert. */
  tryValidate(value) {
    try {
      const clean = this.validateValue(value);
      return { valid: true, value: this.redact(clean), errors: [] };
    } catch (e) {
      return { valid: false, value: null, errors: [e.message] };
    }
  }

  /** Ersetzt sensitive Felder durch einen Redaction-Marker (für Diff/Audit/API). */
  redact(value) {
    if (!value || typeof value !== 'object') return value;
    const out = { ...value };
    for (const f of this._def.sensitiveFields) if (f in out) out[f] = REDACTED;
    return out;
  }

  /** Felddeskriptor (Typ/Default/Constraints) für typisierte Formulare — kein Joi-Leak. */
  fields() {
    const described = this._def.schema.describe();
    const keys = described.keys || {};
    return Object.entries(keys).map(([name, d]) => ({
      name, type: d.type,
      required: !!(d.flags && d.flags.presence === 'required'),
      default: d.flags ? d.flags.default : undefined,
      sensitive: this._def.sensitiveFields.includes(name),
    }));
  }

  toJSON() {
    return {
      id: this.id, scope: this.scope, risk: this.risk,
      description: this._def.description, effect: this._def.effect,
      applyImpact: this._def.applyImpact, applyStatus: this.applyStatus,
      applyEligible: this.applyEligible,
      editable: this.editable, sensitiveFields: this.sensitiveFields,
      allowedTargets: this.allowedTargets, fields: this.fields(),
    };
  }
}

// ─── ConfigTarget — eine erlaubte Zielinstanz (Allowlist) ───────────────────
class ConfigTarget {
  constructor({ id, scope, label }) { this.id = id; this.scope = scope; this.label = label; }
  toJSON() { return { id: this.id, scope: this.scope, label: this.label }; }
}

// ─── Allowlist-Zugriff (unknown = deny) ─────────────────────────────────────
function getCapability(id) {
  const def = CATALOG_BY_ID.get(id);
  if (!def) throw err(`unbekannte Capability: '${id}' — nicht in der Allowlist`, 400);
  return new ConfigCapability(def);
}
function listCapabilities() { return CATALOG.map((def) => new ConfigCapability(def)); }
function getTarget(id) {
  const t = TARGET_BY_ID.get(id);
  if (!t) throw err(`unbekanntes Ziel: '${id}' — nicht in der Allowlist`, 400);
  return new ConfigTarget(t);
}
function listTargets() { return CONFIG_TARGETS.map((t) => new ConfigTarget(t)); }

// Fail-fast: jede apply-eligible Capability MUSS real, editierbar und nicht
// 'prohibited' sein — sonst ist die Allowlist inkonsistent (kein Betrieb).
for (const id of APPLY_ELIGIBLE_CAPABILITY_IDS) {
  const def = CATALOG_BY_ID.get(id);
  if (!def) throw new Error(`apply-eligible Capability '${id}' existiert nicht im Catalog`);
  if (!def.editable) throw new Error(`apply-eligible Capability '${id}' ist nicht editierbar`);
  if (def.risk === 'prohibited') throw new Error(`apply-eligible Capability '${id}' ist 'prohibited'`);
}

/** Prüft Capability↔Ziel-Kompatibilität (Scope + erlaubte Ziele). unknown = deny. */
function assertTargetAllowed(capability, targetId) {
  const target = getTarget(targetId); // wirft bei unbekanntem Ziel
  if (target.scope !== capability.scope) throw err(`Ziel '${targetId}' (scope ${target.scope}) passt nicht zu Capability-Scope ${capability.scope}`);
  if (!capability.allowedTargets.includes(targetId)) throw err(`Ziel '${targetId}' ist für ${capability.id} nicht erlaubt`);
  return target;
}

module.exports = {
  SCOPES, RISK_CLASSES, APPLY_IMPACTS, APPLY_STATUS_NOT_SUPPORTED, REDACTED,
  APPLY_ELIGIBLE_CAPABILITY_IDS, isApplyEligible, applyChannelEnabled,
  ConfigCapability, ConfigTarget,
  getCapability, listCapabilities, getTarget, listTargets, assertTargetAllowed,
  assertNoSecretKeys, err,
};
