'use strict';

/**
 * oidcConfigService.js — effektive OIDC-Konfiguration (P1 #6, In-UI-Admin).
 *
 * Quelle der Wahrheit ist der persistente Settings-Store (platform_settings,
 * Prefix `oidc_`). ENV dient nur noch als SEED/Fallback: solange ein Feld in der
 * DB nicht gesetzt ist, gilt der ENV-Wert (Abwärtskompatibilität mit dem alten
 * reinen ENV-Betrieb). Sobald ein Admin es speichert, gewinnt die DB.
 *
 * SICHERHEIT:
 *   - Das Client-Secret liegt AES-256-GCM-verschlüsselt at-rest (secretsCrypto)
 *     und wird nur in getEffectiveOidcConfig() entschlüsselt — der Admin-Read
 *     (readOidcConfigForAdmin) gibt es NIE im Klartext zurück.
 *   - ENV bleibt backend-only; nichts hiervon verlässt den Server ungefiltert.
 */

const baseConfig = require('../../config');
const { encryptSecret, decryptSecret } = require('../../config/secretsCrypto');

/** Settings-Store-Keys (Prefix oidc_) im gemeinsamen Key-Value-Store. */
const OIDC_SETTING_KEYS = Object.freeze({
  enabled:      'oidc_enabled',
  issuer:       'oidc_issuer',
  clientId:     'oidc_clientId',
  clientSecret: 'oidc_clientSecret', // verschlüsselt
  redirectUri:  'oidc_redirectUri',
  scope:        'oidc_scope',
  defaultRole:  'oidc_defaultRole',
  allowSignup:  'oidc_allowSignup',
});

/** boolean tolerant aus DB-Wert (true/'true'/false/'false'); sonst Fallback. */
function toBool(value, fallback) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

/** DB-Wert (oder null) mit ENV-Seed verschmelzen: null/undefined → ENV. */
function pick(dbValue, envValue) {
  return dbValue !== null && dbValue !== undefined ? dbValue : (envValue ?? '');
}

/**
 * Effektive OIDC-Config inkl. ENTSCHLÜSSELTEM Client-Secret — nur serverintern
 * (Login-Flow). Niemals direkt an einen Client geben.
 *
 * @param {{ get: (k:string)=>Promise<any> }} settingsRepo
 * @param {object} [env] — ENV-Seed (Default: config.oidc), injizierbar für Tests
 */
async function getEffectiveOidcConfig(settingsRepo, env = baseConfig.oidc) {
  const g = (field) => settingsRepo.get(OIDC_SETTING_KEYS[field]);
  const [
    dbEnabled, dbIssuer, dbClientId, dbSecret, dbRedirect, dbScope, dbRole, dbSignup,
  ] = await Promise.all([
    g('enabled'), g('issuer'), g('clientId'), g('clientSecret'),
    g('redirectUri'), g('scope'), g('defaultRole'), g('allowSignup'),
  ]);

  const storedSecret = dbSecret !== null && dbSecret !== undefined && dbSecret !== ''
    ? decryptSecret(dbSecret)
    : (env.clientSecret ?? '');

  return {
    enabled:      toBool(dbEnabled, env.enabled ?? false),
    issuer:       pick(dbIssuer, env.issuer),
    clientId:     pick(dbClientId, env.clientId),
    clientSecret: storedSecret,
    redirectUri:  pick(dbRedirect, env.redirectUri),
    scope:        pick(dbScope, env.scope || 'openid profile email'),
    defaultRole:  pick(dbRole, env.defaultRole || 'viewer'),
    allowSignup:  toBool(dbSignup, env.allowSignup ?? false),
  };
}

/**
 * Admin-Sicht: alles AUSSER dem Secret. Statt des Werts nur Indikatoren —
 * `clientSecretSet` (liegt ein Secret vor) und `configured` (login-bereit).
 */
async function readOidcConfigForAdmin(settingsRepo, env = baseConfig.oidc) {
  const cfg = await getEffectiveOidcConfig(settingsRepo, env);
  const { clientSecret, ...rest } = cfg;
  return {
    ...rest,
    clientSecretSet: clientSecret !== '',
    configured: Boolean(cfg.issuer && cfg.clientId && clientSecret),
  };
}

/**
 * Persistiert ein Config-Patch (nur übergebene Felder). Das Secret wird nur bei
 * einem nicht-leeren Wert verschlüsselt geschrieben — ein leeres Feld lässt das
 * gespeicherte Secret unverändert (maskiertes UI-Feld überschreibt nicht).
 * Gibt die Admin-Sicht (maskiert) zurück.
 *
 * Validierung (Joi) erfolgt vorgelagert in der Route.
 */
async function writeOidcConfig(settingsRepo, patch = {}, env = baseConfig.oidc) {
  if (typeof patch.enabled === 'boolean') await settingsRepo.set(OIDC_SETTING_KEYS.enabled, patch.enabled);
  if (typeof patch.allowSignup === 'boolean') await settingsRepo.set(OIDC_SETTING_KEYS.allowSignup, patch.allowSignup);

  for (const field of ['issuer', 'clientId', 'redirectUri', 'scope', 'defaultRole']) {
    if (typeof patch[field] === 'string') {
      await settingsRepo.set(OIDC_SETTING_KEYS[field], patch[field].trim());
    }
  }

  if (typeof patch.clientSecret === 'string' && patch.clientSecret.trim() !== '') {
    await settingsRepo.set(OIDC_SETTING_KEYS.clientSecret, encryptSecret(patch.clientSecret.trim()));
  }

  return readOidcConfigForAdmin(settingsRepo, env);
}

module.exports = {
  OIDC_SETTING_KEYS,
  getEffectiveOidcConfig,
  readOidcConfigForAdmin,
  writeOidcConfig,
};
