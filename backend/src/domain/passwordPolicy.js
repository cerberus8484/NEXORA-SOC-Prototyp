'use strict';

// Passwort-Policy-Validator — reiner, zustandsloser Validator ohne externe Deps.
//
// Komplexitätsstufen:
//   low    = nur Mindestlänge
//   medium = Mindestlänge + min. 1 Buchstabe + min. 1 Ziffer
//   high   = Mindestlänge + Großbuchstabe + Kleinbuchstabe + Ziffer + Sonderzeichen

const COMPLEXITY_LEVELS = ['low', 'medium', 'high'];
const DEFAULT_MIN_LENGTH = 8;
const DEFAULT_COMPLEXITY = 'medium';

// Sonderzeichen: alles, was weder Buchstabe noch Ziffer ist (ASCII und Nicht-ASCII).
const RE_UPPERCASE   = /[A-Z]/;
const RE_LOWERCASE   = /[a-z]/;
const RE_DIGIT       = /[0-9]/;
const RE_LETTER      = /[a-zA-Z]/;
// Sonderzeichen = alles außer Buchstaben und Ziffern (inkl. Unicode wie €, ä, etc.)
const RE_SPECIAL     = /[^A-Za-z0-9]/;

/**
 * Validiert ein Passwort gegen die gegebene Policy.
 *
 * @param {string|null|undefined} password  — das zu prüfende Klartext-Passwort
 * @param {{ minLength?: number, complexity?: string }} policy — Policy-Optionen
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validatePassword(password, policy = {}) {
  const minLength  = (typeof policy.minLength === 'number' && policy.minLength >= 1)
    ? policy.minLength
    : DEFAULT_MIN_LENGTH;
  const complexity = COMPLEXITY_LEVELS.includes(policy.complexity)
    ? policy.complexity
    : DEFAULT_COMPLEXITY;

  // Null/Undefined/Non-String → sofort fehlschlagen
  if (typeof password !== 'string') {
    return {
      ok:     false,
      errors: [`Passwort fehlt oder ist kein gültiger String`],
    };
  }

  const errors = [];

  // ── Längenprüfung (alle Stufen) ───────────────────────────────────────────
  if (password.length < minLength) {
    errors.push(`Passwort muss mindestens ${minLength} Zeichen lang sein`);
  }

  // ── Komplexitätsprüfungen ────────────────────────────────────────────────
  if (complexity === 'medium' || complexity === 'high') {
    if (!RE_LETTER.test(password)) {
      errors.push('Passwort muss mindestens einen Buchstaben enthalten');
    }
    if (!RE_DIGIT.test(password)) {
      errors.push('Passwort muss mindestens eine Ziffer enthalten');
    }
  }

  if (complexity === 'high') {
    if (!RE_UPPERCASE.test(password)) {
      errors.push('Passwort muss mindestens einen Großbuchstaben enthalten');
    }
    if (!RE_LOWERCASE.test(password)) {
      errors.push('Passwort muss mindestens einen Kleinbuchstaben enthalten');
    }
    if (!RE_SPECIAL.test(password)) {
      errors.push('Passwort muss mindestens ein Sonderzeichen enthalten');
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Reiht den aktuellen (alten) Hash vorne in die Passwort-History ein und
 * trimmt auf die History-Länge. count<=0 → History deaktiviert → leeres Array.
 *
 * @param {string[]} history — bestehende Hash-History (neueste zuerst)
 * @param {string}   hash    — der zu archivierende (bisherige) Hash
 * @param {number}   count   — wie viele alte Passwörter aufbewahrt werden
 * @returns {string[]} neue History (neueste zuerst, max. count Einträge)
 */
function pushPasswordHistory(history, hash, count) {
  if (!count || count <= 0) return [];
  const prev = Array.isArray(history) ? history : [];
  const next = hash ? [hash, ...prev] : [...prev];
  return next.slice(0, count);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Prüft, ob ein Passwort gemäß Ablauf-Policy abgelaufen ist.
 * expiryDays<=0 → deaktiviert → nie abgelaufen.
 * Unbekanntes Änderungsdatum (null/ungültig) bei aktiver Policy → als abgelaufen
 * behandeln (erzwingt einen einmaligen Wechsel nach Policy-Aktivierung).
 *
 * @param {string|null} passwordChangedAt — ISO-Zeitstempel der letzten Änderung
 * @param {number} expiryDays — max. Passwort-Alter in Tagen (0 = aus)
 * @returns {boolean}
 */
function isPasswordExpired(passwordChangedAt, expiryDays) {
  if (!expiryDays || expiryDays <= 0) return false;
  if (!passwordChangedAt) return true;
  const changed = new Date(passwordChangedAt).getTime();
  if (Number.isNaN(changed)) return true;
  return (Date.now() - changed) > expiryDays * MS_PER_DAY;
}

module.exports = {
  validatePassword,
  pushPasswordHistory,
  isPasswordExpired,
  COMPLEXITY_LEVELS,
  DEFAULT_MIN_LENGTH,
  DEFAULT_COMPLEXITY,
};
