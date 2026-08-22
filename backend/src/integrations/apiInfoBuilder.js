'use strict';

/**
 * apiInfoBuilder — reine Mapping-Funktion für GET /integrations/api-info
 *
 * Baut das API-Info-Objekt aus ENV + Config.
 * Keine Netzwerk-Calls, keine Seiteneffekte — vollständig testbar ohne Mocks.
 *
 * SICHERHEITSREGEL (ADR-009):
 *   hmacConfigured ist IMMER nur ein boolean.
 *   Der tatsächliche Secret-Wert darf NIEMALS in der Response erscheinen.
 *
 * @param {Record<string, string|undefined>} env   — process.env (oder Test-Override)
 * @param {{ rateLimit?: { max: number, windowMs: number, webhookMax: number } }} config
 * @returns {{ rateLimit: RateLimit, webhookReceivers: WebhookReceiver[] }}
 */

const { KNOWN_SOURCES } = require('./IntegrationEvent');

// Fallback-Defaults — entsprechen config/index.js-Werten
const DEFAULT_RATE_LIMIT = {
  max:        200,
  windowMs:   60_000,
  webhookMax: 1_000,
};

/**
 * Prüft ob für eine Quelle ein HMAC-Secret konfiguriert ist.
 * Gibt NUR boolean zurück — niemals den Secret-Wert.
 *
 * @param {string} source
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
function isHmacConfigured(source, env) {
  const sourceKey  = `WEBHOOK_SECRET_${source.toUpperCase()}`;
  const genericKey = 'WEBHOOK_SECRET_GENERIC';
  return Boolean(env[sourceKey]) || Boolean(env[genericKey]);
}

/**
 * Baut das vollständige API-Info-Objekt.
 *
 * @param {Record<string, string|undefined>} env
 * @param {{ rateLimit?: { max: number, windowMs: number, webhookMax: number } }} config
 */
function buildApiInfo(env, config) {
  const rateLimit = {
    max:        (config.rateLimit?.max        ?? DEFAULT_RATE_LIMIT.max),
    windowMs:   (config.rateLimit?.windowMs   ?? DEFAULT_RATE_LIMIT.windowMs),
    webhookMax: (config.rateLimit?.webhookMax ?? DEFAULT_RATE_LIMIT.webhookMax),
  };

  const webhookReceivers = KNOWN_SOURCES.map((source) => ({
    source,
    path:           `/api/v1/integrations/${source}/webhook`,
    hmacConfigured: isHmacConfigured(source, env),
  }));

  return { rateLimit, webhookReceivers };
}

module.exports = { buildApiInfo };
