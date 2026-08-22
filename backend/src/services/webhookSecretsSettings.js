'use strict';

// Layer 2 (Frontend-Administrierbarkeit): Inbound-Webhook-HMAC-Secrets (Alert→Ticket)
// admin-seitig verwalten statt nur ENV. Ein Secret je Quelle, AES-256-GCM verschlüsselt
// in `platform_settings` (Key `webhook_secrets`), DB > ENV.
//
// Der Webhook-Handler löst pro Request DB > ENV auf → eine Rotation greift SOFORT,
// ohne Neustart. Fallback-Kette wie bisher: eine Quelle ohne eigenes Secret nutzt das
// `generic`-Secret (DB oder ENV).

const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const WEBHOOK_SECRETS_KEY = 'webhook_secrets';
// Quellen mit HMAC-signiertem Inbound-Webhook. (crowdsec = LAPI-Poller, email = IMAP/
// separater Webhook-Secret → nicht Teil dieser Karte.)
const WEBHOOK_SOURCES = Object.freeze(['wazuh', 'qradar', 'splunk', 'dataplane', 'generic']);

const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const s = await repo.get(WEBHOOK_SECRETS_KEY);
  return s && typeof s === 'object' ? s : {};
}

function _envSecret(source, env) {
  return env[`WEBHOOK_SECRET_${String(source).toUpperCase()}`] || '';
}

/**
 * Effektives HMAC-Secret einer Quelle (backend-intern, Klartext für die Verifikation):
 * DB[source] > ENV[source] > DB[generic] > ENV[generic] > null.
 */
async function resolveWebhookSecret(repo, source, env = process.env) {
  const src = String(source || '').toLowerCase();
  const stored = await _getStored(repo);
  const dbSrc = decryptSecret(stored[src] || '');
  if (dbSrc) return dbSrc;
  const envSrc = _envSecret(src, env);
  if (envSrc) return envSrc;
  const dbGen = decryptSecret(stored.generic || '');
  if (dbGen) return dbGen;
  return _envSecret('generic', env) || null;
}

/**
 * Speichert/rotiert das Secret einer Quelle. Leeres Secret = Quelle löschen
 * (→ zurück auf ENV/generic-Fallback). Wirft WEBHOOK_SOURCE_UNKNOWN bei unbekannter Quelle.
 */
async function saveWebhookSecret(repo, source, secret) {
  const src = String(source || '').toLowerCase();
  if (!WEBHOOK_SOURCES.includes(src)) {
    const err = new Error(`Unbekannte Webhook-Quelle: ${source}`);
    err.code = 'WEBHOOK_SOURCE_UNKNOWN';
    throw err;
  }
  const stored = await _getStored(repo);
  const val = _trim(secret);
  const next = { ...stored };
  if (val === '') delete next[src];
  else next[src] = encryptSecret(val);
  await repo.set(WEBHOOK_SECRETS_KEY, next);
  return { source: src, set: val !== '' };
}

/**
 * Maskierte Sicht fürs Frontend — NIE ein Secret-Wert, nur je Quelle `set` + Herkunft.
 * `origin`: db (eigenes DB-Secret) · env (eigenes ENV-Secret) · none (nur generic-Fallback/leer).
 */
async function maskedWebhookSecrets(repo, env = process.env) {
  const stored = await _getStored(repo);
  return WEBHOOK_SOURCES.map((source) => {
    if (decryptSecret(stored[source] || '')) return { source, set: true, origin: 'db' };
    if (_envSecret(source, env)) return { source, set: true, origin: 'env' };
    return { source, set: false, origin: 'none' };
  });
}

module.exports = {
  WEBHOOK_SECRETS_KEY,
  WEBHOOK_SOURCES,
  resolveWebhookSecret,
  saveWebhookSecret,
  maskedWebhookSecrets,
};
