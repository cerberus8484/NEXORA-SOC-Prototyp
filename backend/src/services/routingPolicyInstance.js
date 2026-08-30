'use strict';

// Lädt die aktive ML-Routing-Policy aus einem Artefakt (ml:policy-export →
// recommended-routing-policy.json), gesteuert über ML_ROUTING_POLICY_PATH.
//
// Fail-safe by design: ist die ENV-Variable nicht gesetzt, das File fehlt, die
// Policy blockiert/falsches Schema, ODER irgendein Fehler tritt auf → { active:false }.
// Dann bleibt das bisherige Verhalten unverändert (kein Advisory). Default AUS.

const fs = require('fs');
const { SCHEMA_VERSION } = require('../domain/mlRoutingPolicy');
const logger = require('../logger');

const INACTIVE = Object.freeze({ active: false });

let cached; // undefined = noch nicht geladen

function loadActiveRoutingPolicy(env = process.env) {
  const policyPath = env.ML_ROUTING_POLICY_PATH;
  if (!policyPath) return { active: false, reason: 'unset' };

  // Den absoluten Pfad bewusst NICHT loggen oder im Return-Objekt führen — er soll
  // nirgends in Logs/SIEM/Responses landen (Konsistenz mit dem No-Leak-Ziel von /status).
  try {
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    if (policy.schemaVersion !== SCHEMA_VERSION) {
      logger.warn('routing_policy_inactive', { reason: 'schema_mismatch', got: policy.schemaVersion });
      return { active: false, reason: 'schema_mismatch' };
    }
    if (policy.status !== 'ready') {
      logger.warn('routing_policy_inactive', { reason: 'policy_blocked', status: policy.status });
      return { active: false, reason: 'policy_blocked' };
    }
    if (typeof policy.recommendedThreshold !== 'number' || !Number.isFinite(policy.recommendedThreshold)) {
      return { active: false, reason: 'no_threshold' };
    }
    logger.info('routing_policy_active', {
      policyName: policy.policyName, threshold: policy.recommendedThreshold,
    });
    // Explizite Allowlist statt das geparste Objekt durchzureichen — keine Fremd-Keys.
    return {
      active: true,
      policyName: String(policy.policyName),
      threshold: policy.recommendedThreshold,
    };
  } catch (err) {
    logger.warn('routing_policy_load_failed', { error: err && err.message });
    return { active: false, reason: 'load_error' };
  }
}

// Memoisiert beim ersten Aufruf (Policy ändert sich nur per Deploy/Neustart).
function getActiveRoutingPolicy() {
  if (cached === undefined) cached = loadActiveRoutingPolicy();
  return cached || INACTIVE;
}

// Nur für Tests: Cache leeren, damit ein neu gesetztes ENV greift.
function _resetForTest() {
  cached = undefined;
}

module.exports = { loadActiveRoutingPolicy, getActiveRoutingPolicy, _resetForTest };
