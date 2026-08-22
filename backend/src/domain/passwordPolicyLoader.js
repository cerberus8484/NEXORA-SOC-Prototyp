'use strict';

// passwordPolicyLoader — lädt die aktuelle Passwort-Policy + Session-Dauer
// aus dem Settings-KV-Store.
//
// Abhängigkeits-Richtung: domain → repository (über Factory).
// Kein direkter Pool-Import hier — der Settings-Repo ist bereits entkoppelt.
//
// Die Defaults hier MÜSSEN mit PLATFORM_DEFAULTS in routes/settings.js übereinstimmen.

const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { DEFAULT_MIN_LENGTH, DEFAULT_COMPLEXITY } = require('./passwordPolicy');

const DEFAULT_SESSION_MAX_HOURS = 8;

// Account-Lockout-Defaults — MÜSSEN mit PLATFORM_DEFAULTS in routes/settings.js übereinstimmen.
// maxAttempts 0 = deaktiviert (Default): kein Verhaltenswechsel ohne Admin-Aktivierung.
const DEFAULT_LOCKOUT_MAX_ATTEMPTS = 0;
const DEFAULT_LOCKOUT_MINUTES      = 15;

// Passwort-Aging-Defaults — beide 0 = deaktiviert.
const DEFAULT_PASSWORD_EXPIRY_DAYS   = 0;
const DEFAULT_PASSWORD_HISTORY_COUNT = 0;

// Concurrent-Session-Limit — 0 = unbegrenzt.
const DEFAULT_MAX_CONCURRENT_SESSIONS = 0;

// Org-weite MFA-Pflicht — default aus.
const DEFAULT_MFA_REQUIRED = false;

// Lazy-Singleton: dasselbe Repo wie die Settings-Route verwendet.
// (In Tests wird dieses Modul komplett gemockt — kein Repo-Zugriff in Tests.)
let _repo = null;
function _getRepo() {
  if (!_repo) _repo = createSettingsRepository();
  return _repo;
}

/**
 * Liest passwordMinLength + passwordComplexity aus dem KV-Store.
 * Gibt immer ein gültiges Objekt zurück — Fehler beim Lesen = Defaults.
 *
 * @returns {Promise<{ minLength: number, complexity: string }>}
 */
async function loadPasswordPolicy() {
  try {
    const repo       = _getRepo();
    const minLength  = await repo.get('platform_passwordMinLength');
    const complexity = await repo.get('platform_passwordComplexity');
    return {
      minLength:  typeof minLength  === 'number' ? minLength  : DEFAULT_MIN_LENGTH,
      complexity: typeof complexity === 'string' ? complexity : DEFAULT_COMPLEXITY,
    };
  } catch {
    // Fail-safe: Policy-Laden schlägt den Login nicht tot.
    return { minLength: DEFAULT_MIN_LENGTH, complexity: DEFAULT_COMPLEXITY };
  }
}

/**
 * Liest sessionMaxHours aus dem KV-Store.
 * Gibt null zurück wenn kein Wert gespeichert ist (Aufrufer nutzt dann JWT_EXPIRES_IN).
 *
 * @returns {Promise<number|null>}
 */
async function loadSessionMaxHours() {
  try {
    const repo  = _getRepo();
    const hours = await repo.get('platform_sessionMaxHours');
    return typeof hours === 'number' ? hours : null;
  } catch {
    return null;
  }
}

/**
 * Liest die Account-Lockout-Policy aus dem KV-Store.
 * Gibt immer ein gültiges Objekt zurück — Fehler beim Lesen = Defaults (deaktiviert).
 *
 * @returns {Promise<{ maxAttempts: number, minutes: number }>}
 */
async function loadLockoutPolicy() {
  try {
    const repo        = _getRepo();
    const maxAttempts = await repo.get('platform_lockoutMaxAttempts');
    const minutes     = await repo.get('platform_lockoutMinutes');
    return {
      maxAttempts: typeof maxAttempts === 'number' ? maxAttempts : DEFAULT_LOCKOUT_MAX_ATTEMPTS,
      minutes:     typeof minutes     === 'number' ? minutes     : DEFAULT_LOCKOUT_MINUTES,
    };
  } catch {
    // Fail-safe: Lockout-Laden schlägt den Login nicht tot.
    return { maxAttempts: DEFAULT_LOCKOUT_MAX_ATTEMPTS, minutes: DEFAULT_LOCKOUT_MINUTES };
  }
}

/**
 * Liest die Passwort-Aging-Policy (Ablauf + History) aus dem KV-Store.
 * Gibt immer ein gültiges Objekt zurück — Fehler beim Lesen = Defaults (aus).
 *
 * @returns {Promise<{ expiryDays: number, historyCount: number }>}
 */
async function loadPasswordAgingPolicy() {
  try {
    const repo         = _getRepo();
    const expiryDays   = await repo.get('platform_passwordExpiryDays');
    const historyCount = await repo.get('platform_passwordHistoryCount');
    return {
      expiryDays:   typeof expiryDays   === 'number' ? expiryDays   : DEFAULT_PASSWORD_EXPIRY_DAYS,
      historyCount: typeof historyCount === 'number' ? historyCount : DEFAULT_PASSWORD_HISTORY_COUNT,
    };
  } catch {
    return { expiryDays: DEFAULT_PASSWORD_EXPIRY_DAYS, historyCount: DEFAULT_PASSWORD_HISTORY_COUNT };
  }
}

/**
 * Liest das Concurrent-Session-Limit aus dem KV-Store.
 * @returns {Promise<number>} max. gleichzeitige Sitzungen (0 = unbegrenzt)
 */
async function loadMaxConcurrentSessions() {
  try {
    const repo = _getRepo();
    const max  = await repo.get('platform_maxConcurrentSessions');
    return typeof max === 'number' ? max : DEFAULT_MAX_CONCURRENT_SESSIONS;
  } catch {
    return DEFAULT_MAX_CONCURRENT_SESSIONS;
  }
}

/**
 * Liest die org-weite MFA-Pflicht aus dem KV-Store.
 * @returns {Promise<boolean>} true = jeder User muss MFA einrichten (Login erzwingt Setup)
 */
async function loadMfaRequired() {
  try {
    const repo = _getRepo();
    const req  = await repo.get('platform_mfaRequired');
    return typeof req === 'boolean' ? req : DEFAULT_MFA_REQUIRED;
  } catch {
    // Fail-safe: Pflicht-Laden schlägt den Login nicht tot (eher zu lasch als Lockout).
    return DEFAULT_MFA_REQUIRED;
  }
}

module.exports = {
  loadPasswordPolicy,
  loadSessionMaxHours,
  loadLockoutPolicy,
  loadPasswordAgingPolicy,
  loadMaxConcurrentSessions,
  loadMfaRequired,
  DEFAULT_SESSION_MAX_HOURS,
  DEFAULT_LOCKOUT_MAX_ATTEMPTS,
  DEFAULT_LOCKOUT_MINUTES,
  DEFAULT_PASSWORD_EXPIRY_DAYS,
  DEFAULT_PASSWORD_HISTORY_COUNT,
  DEFAULT_MAX_CONCURRENT_SESSIONS,
  DEFAULT_MFA_REQUIRED,
};
