'use strict';

// Joi-Schema für PUT /settings/platform.
// Ehrlichkeits-Regel (ADR-009): Nur Keys die wir meinen — keine Sicherheits-Toggles
// (MFA, TLS, SSO) hier. Diese Felder gehören in dedizierte Endpunkte, sobald
// wir echte Enforce-Logik haben. PLATFORM_KEYS = reine Plattform-Konfiguration.
//
// Phase 2: Drei echte Security-Keys die serverseitig durchgesetzt werden:
//   passwordMinLength  — steuert AuthService/UserService-Validator
//   passwordComplexity — steuert AuthService/UserService-Validator
//   sessionMaxHours    — steuert JWT expiresIn bei login

const Joi = require('joi');

const VALID_DEFAULT_VIEWS  = ['dashboard', 'tickets', 'hunts'];
const VALID_LANGUAGES      = ['de', 'en'];
const VALID_COMPLEXITIES   = ['low', 'medium', 'high'];

// Sinnvolle Caps: minLength 8–128, sessionMaxHours 1–168 (max 7 Tage).
const PASSWORD_MIN_LENGTH_FLOOR   =   8;
const PASSWORD_MIN_LENGTH_CEILING = 128;
const SESSION_MAX_HOURS_FLOOR     =   1;
const SESSION_MAX_HOURS_CEILING   = 168;

// Account-Lockout: maxAttempts 0–100 (0 = deaktiviert), Sperrdauer 1–1440 Min. (max 24h).
const LOCKOUT_MAX_ATTEMPTS_FLOOR   =    0;
const LOCKOUT_MAX_ATTEMPTS_CEILING =  100;
const LOCKOUT_MINUTES_FLOOR        =    1;
const LOCKOUT_MINUTES_CEILING      = 1440;

// Passwort-Aging: Ablauf 0–3650 Tage (0 = aus), History 0–50 (0 = aus).
const PASSWORD_EXPIRY_DAYS_FLOOR   =    0;
const PASSWORD_EXPIRY_DAYS_CEILING = 3650;
const PASSWORD_HISTORY_FLOOR       =    0;
const PASSWORD_HISTORY_CEILING     =   50;

// Concurrent-Session-Limit: 0 = unbegrenzt, max 100.
const MAX_CONCURRENT_SESSIONS_FLOOR   =   0;
const MAX_CONCURRENT_SESSIONS_CEILING = 100;

// Inaktivitäts-Timeout (clientseitig erzwungen): 0 = aus, max 1440 Min. (24h).
const INACTIVITY_TIMEOUT_FLOOR   =    0;
const INACTIVITY_TIMEOUT_CEILING = 1440;

// Gültiges 6-stelliges Hex-Color-Pattern: #rrggbb (Groß- oder Kleinschreibung)
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Einzelner IPv4- oder CIDR-Eintrag (Bits 0–32). Oktett-Range wird separat geprüft.
const CIDR_ENTRY_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(3[0-2]|[12]?\d))?$/;

// Joi-Custom: komma-/zeilengetrennte IPv4/CIDR-Liste validieren (leer = erlaubt).
function validateCidrList(value, helpers) {
  if (value === '') return value;
  const entries = value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const m = CIDR_ENTRY_PATTERN.exec(entry);
    if (!m || [m[1], m[2], m[3], m[4]].some((o) => Number(o) > 255)) {
      return helpers.error('any.invalid');
    }
  }
  return value;
}

const platformSettingsSchema = Joi.object({
  // Plattform-Basis
  platformName:    Joi.string().max(200).allow(''),
  defaultView:     Joi.string().valid(...VALID_DEFAULT_VIEWS),
  timezone:        Joi.string().max(100).allow(''),
  language:        Joi.string().valid(...VALID_LANGUAGES),
  maintenanceMode: Joi.boolean(),
  betaFeatures:    Joi.boolean(),

  // Branding
  accentColor: Joi.string().pattern(HEX_COLOR_PATTERN).messages({
    'string.pattern.base': 'accentColor muss ein gültiger Hex-Farbwert sein (#rrggbb)',
  }),
  // Branding-Erweiterung: Schriftart-Stack (kuratierte, system-sichere Keys — kein
  // freier Font-String, damit nichts Externes geladen wird / CSP sauber bleibt).
  fontFamily: Joi.string().valid('default', 'system', 'serif', 'mono').messages({
    'any.only': 'fontFamily muss einer von default, system, serif, mono sein',
  }),
  backgroundColor: Joi.string().pattern(HEX_COLOR_PATTERN).messages({
    'string.pattern.base': 'backgroundColor muss ein gültiger Hex-Farbwert sein (#rrggbb)',
  }),
  sidebarColor: Joi.string().pattern(HEX_COLOR_PATTERN).messages({
    'string.pattern.base': 'sidebarColor muss ein gültiger Hex-Farbwert sein (#rrggbb)',
  }),

  // Security-Keys — Phase 2 (serverseitig durchgesetzt)
  passwordMinLength:  Joi.number().integer()
    .min(PASSWORD_MIN_LENGTH_FLOOR)
    .max(PASSWORD_MIN_LENGTH_CEILING),
  passwordComplexity: Joi.string().valid(...VALID_COMPLEXITIES),
  sessionMaxHours:    Joi.number().integer()
    .min(SESSION_MAX_HOURS_FLOOR)
    .max(SESSION_MAX_HOURS_CEILING),

  // Account-Lockout — Phase 2 (serverseitig durchgesetzt, 0 = deaktiviert)
  lockoutMaxAttempts: Joi.number().integer()
    .min(LOCKOUT_MAX_ATTEMPTS_FLOOR)
    .max(LOCKOUT_MAX_ATTEMPTS_CEILING),
  lockoutMinutes:     Joi.number().integer()
    .min(LOCKOUT_MINUTES_FLOOR)
    .max(LOCKOUT_MINUTES_CEILING),

  // Passwort-Aging — Welle 2 (serverseitig durchgesetzt, 0 = deaktiviert)
  passwordExpiryDays:   Joi.number().integer()
    .min(PASSWORD_EXPIRY_DAYS_FLOOR)
    .max(PASSWORD_EXPIRY_DAYS_CEILING),
  passwordHistoryCount: Joi.number().integer()
    .min(PASSWORD_HISTORY_FLOOR)
    .max(PASSWORD_HISTORY_CEILING),

  // Concurrent-Session-Limit — Welle 2 (serverseitig durchgesetzt, 0 = unbegrenzt)
  maxConcurrentSessions: Joi.number().integer()
    .min(MAX_CONCURRENT_SESSIONS_FLOOR)
    .max(MAX_CONCURRENT_SESSIONS_CEILING),

  // Inaktivitäts-Timeout — Welle 2 (clientseitig erzwungen, 0 = aus)
  inactivityTimeoutMinutes: Joi.number().integer()
    .min(INACTIVITY_TIMEOUT_FLOOR)
    .max(INACTIVITY_TIMEOUT_CEILING),

  // Zugriffskontrolle — Welle 1 (serverseitig durchgesetzt, default aus)
  tlsEnforce:         Joi.boolean(),
  ipAllowlistEnabled: Joi.boolean(),
  ipAllowlistCidrs:   Joi.string().max(2000).allow('').custom(validateCidrList).messages({
    'any.invalid': 'ipAllowlistCidrs enthält ungültige IPv4/CIDR-Einträge',
  }),
  // Org-weite MFA-Pflicht (greift nur wenn MFA_ENABLED) — serverseitig im Login erzwungen.
  mfaRequired:        Joi.boolean(),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = {
  platformSettingsSchema,
  VALID_DEFAULT_VIEWS,
  VALID_LANGUAGES,
  VALID_COMPLEXITIES,
  PASSWORD_MIN_LENGTH_FLOOR,
  PASSWORD_MIN_LENGTH_CEILING,
  SESSION_MAX_HOURS_FLOOR,
  SESSION_MAX_HOURS_CEILING,
  LOCKOUT_MAX_ATTEMPTS_FLOOR,
  LOCKOUT_MAX_ATTEMPTS_CEILING,
  LOCKOUT_MINUTES_FLOOR,
  LOCKOUT_MINUTES_CEILING,
  PASSWORD_EXPIRY_DAYS_FLOOR,
  PASSWORD_EXPIRY_DAYS_CEILING,
  PASSWORD_HISTORY_FLOOR,
  PASSWORD_HISTORY_CEILING,
  MAX_CONCURRENT_SESSIONS_FLOOR,
  MAX_CONCURRENT_SESSIONS_CEILING,
  INACTIVITY_TIMEOUT_FLOOR,
  INACTIVITY_TIMEOUT_CEILING,
  HEX_COLOR_PATTERN,
};
