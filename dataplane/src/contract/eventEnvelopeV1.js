'use strict';

// ─────────────────────────────────────────────────────────────────────────
// EventEnvelopeV1 — kanonischer Contract zwischen Collector/Collector und Intake.
// Quelle: Nexora-Dataplane ADR-002. Dependency-frei + pur → überall testbar.
//
// Disziplin:
//  - schemaVersion MUSS exakt "1.0" sein (Versionierung für Breaking Changes).
//  - Collector setzt: eventId(UUIDv4), observedAt, source.*, raw.{hash,ref}, provenance.*,
//    optional normalized.entities.
//  - Server setzt (NICHT vom Collector): collector.{collectorId,siteId}, tenantId, receivedAt.
//    → `tenantId` im eingehenden Envelope ist VERBOTEN (Tenant-Isolation, ADR-002).
//  - Kein Raw-Payload im Envelope — nur `raw.ref` (Referenz auf Raw-Storage).
//  - Limits: normalized.entities ≤ 50, provenance.warnings ≤ 10, raw.ref ≤ 2000.
// ─────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = '1.0';
const MAX_ENTITIES = 50;
const MAX_WARNINGS = 10;
const MAX_RAW_REF = 2000;
const MAX_ACTIVITY_VALUE = 2000;
// Sitzungs-Aktivität eines Detection-Events (z.B. Cowrie): welcher Angreifer-Schritt.
const ACTIVITY_KINDS = ['command', 'login', 'download', 'tunnel'];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

// Vom Server gesetzte Felder — dürfen im eingehenden Envelope NICHT bestimmt werden.
const SERVER_SET = ['tenantId', 'receivedAt'];

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isNonEmptyString(v) { return typeof v === 'string' && v.trim() !== ''; }
function isIsoDate(v) { return typeof v === 'string' && !Number.isNaN(Date.parse(v)); }

/**
 * Validiert einen eingehenden EventEnvelope gegen den V1-Contract.
 * @param {unknown} env
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEnvelope(env) {
  const errors = [];
  const add = (msg) => errors.push(msg);

  if (!isObject(env)) {
    return { valid: false, errors: ['envelope: must be an object'] };
  }

  // 1) schemaVersion
  if (env.schemaVersion !== SCHEMA_VERSION) {
    add(`schemaVersion: must be exactly "${SCHEMA_VERSION}"`);
  }

  // 2) eventId (UUIDv4 — Idempotenz)
  if (!isNonEmptyString(env.eventId) || !UUID_V4.test(env.eventId)) {
    add('eventId: must be a UUIDv4');
  }

  // 3) observedAt
  if (!isIsoDate(env.observedAt)) {
    add('observedAt: must be an ISO-8601 timestamp');
  }

  // 4) source.{type,vendor,instanceId}
  if (!isObject(env.source)) {
    add('source: must be an object');
  } else {
    for (const k of ['type', 'vendor', 'instanceId']) {
      if (!isNonEmptyString(env.source[k])) add(`source.${k}: required non-empty string`);
    }
  }

  // 5) raw.{hash(sha256), ref(≤2000)} — kein Raw-Payload
  if (!isObject(env.raw)) {
    add('raw: must be an object');
  } else {
    if (!isNonEmptyString(env.raw.hash) || !SHA256_HEX.test(env.raw.hash)) {
      add('raw.hash: must be a SHA-256 hex string (64 chars)');
    }
    if (!isNonEmptyString(env.raw.ref)) {
      add('raw.ref: required non-empty string');
    } else if (env.raw.ref.length > MAX_RAW_REF) {
      add(`raw.ref: must be ≤ ${MAX_RAW_REF} chars`);
    }
    if ('payload' in env.raw || 'data' in env.raw) {
      add('raw: must NOT carry a payload — reference only (raw.ref)');
    }
  }

  // 6) provenance.{parserVersion,confidence,warnings?}
  if (!isObject(env.provenance)) {
    add('provenance: must be an object');
  } else {
    if (!isNonEmptyString(env.provenance.parserVersion)) {
      add('provenance.parserVersion: required non-empty string');
    }
    const c = env.provenance.confidence;
    if (typeof c !== 'number' || Number.isNaN(c) || c < 0 || c > 1) {
      add('provenance.confidence: required number in [0,1]');
    }
    if (env.provenance.warnings !== undefined) {
      if (!Array.isArray(env.provenance.warnings)) add('provenance.warnings: must be an array');
      else if (env.provenance.warnings.length > MAX_WARNINGS) add(`provenance.warnings: max ${MAX_WARNINGS}`);
    }
  }

  // 7) normalized.entities? (optional, gedeckelt)
  if (env.normalized !== undefined) {
    if (!isObject(env.normalized)) {
      add('normalized: must be an object');
    } else {
      if (env.normalized.entities !== undefined) {
        if (!Array.isArray(env.normalized.entities)) add('normalized.entities: must be an array');
        else if (env.normalized.entities.length > MAX_ENTITIES) add(`normalized.entities: max ${MAX_ENTITIES}`);
      }
      // Sitzungs-Aktivität (additiv, optional): { kind ∈ ACTIVITY_KINDS, value?, user? }.
      const act = env.normalized.activity;
      if (act !== undefined) {
        if (!isObject(act)) {
          add('normalized.activity: must be an object');
        } else {
          if (!ACTIVITY_KINDS.includes(act.kind)) add(`normalized.activity.kind: must be one of ${ACTIVITY_KINDS.join(', ')}`);
          if (act.value !== undefined && (typeof act.value !== 'string' || act.value.length > MAX_ACTIVITY_VALUE)) {
            add(`normalized.activity.value: must be a string ≤ ${MAX_ACTIVITY_VALUE} chars`);
          }
          if (act.user !== undefined && (typeof act.user !== 'string' || act.user.length > MAX_ACTIVITY_VALUE)) {
            add(`normalized.activity.user: must be a string ≤ ${MAX_ACTIVITY_VALUE} chars`);
          }
        }
      }
    }
  }

  // 8) Server-gesetzte Felder dürfen NICHT vom Collector kommen (Tenant-Isolation!)
  for (const f of SERVER_SET) {
    if (f in env) add(`${f}: must NOT be set by collector (server-assigned)`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateEnvelope,
  SCHEMA_VERSION,
  MAX_ENTITIES,
  MAX_WARNINGS,
  MAX_RAW_REF,
  MAX_ACTIVITY_VALUE,
  ACTIVITY_KINDS,
  SERVER_SET,
};
