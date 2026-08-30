'use strict';

// Layer 2 (Frontend-Administrierbarkeit): Outbound-Benachrichtigungen (SMTP-Email +
// Webhooks + Master-Schalter) aus der DB verwalten statt nur ENV. Konvention:
//   - DB gewinnt über ENV, ENV bleibt Fail-safe-Fallback,
//   - Secrets (SMTP-Passwort, Webhook-URLs mit Token) AES-256-GCM-verschlüsselt,
//   - nach außen nur maskiert (*Set-Boolean + Quelle).
//
// deliverOutbound liest die effektive Config zur Sendezeit → kein Applier/Neustart nötig.

const config = require('../config');
const { encryptSecret, decryptSecret } = require('./../config/secretsCrypto');

const NOTIFICATION_SETTINGS_KEY = 'integration_notifications';
const WEBHOOK_FIELDS = ['slackWebhookUrl', 'genericWebhookUrl', 'teamsWebhookUrl'];

const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const stored = await repo.get(NOTIFICATION_SETTINGS_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

// ── resolve ─────────────────────────────────────────────────────────────────

function _resolveEmail(storedEmail, envEmail) {
  if (storedEmail && _trim(storedEmail.host) !== '') {
    return {
      host:   _trim(storedEmail.host),
      port:   Number(storedEmail.port) || 587,
      secure: storedEmail.secure === true,
      user:   _trim(storedEmail.user),
      pass:   decryptSecret(storedEmail.pass || ''),
      from:   _trim(storedEmail.from),
      to:     _trim(storedEmail.to),
      source: 'db',
    };
  }
  const envConfigured = Boolean(envEmail && envEmail.host);
  return { ...envEmail, source: envConfigured ? 'env' : 'none' };
}

function _resolveWebhook(storedVal, envVal) {
  if (typeof storedVal === 'string' && storedVal !== '') {
    return { url: decryptSecret(storedVal), source: 'db' };
  }
  return { url: envVal || '', source: envVal ? 'env' : 'none' };
}

/** Effektive Notify-Config (DB > ENV) — Secrets entschlüsselt, backend-intern. */
async function resolveNotificationConfig(repo) {
  const stored = await _getStored(repo);
  const env = config.notifications;

  const email = _resolveEmail(stored.email, env.email);
  const cfg = {
    outboundEnabled: typeof stored.outboundEnabled === 'boolean' ? stored.outboundEnabled : Boolean(env.outboundEnabled),
    email: { host: email.host, port: email.port, secure: email.secure, user: email.user, pass: email.pass, from: email.from, to: email.to },
  };
  const envMap = { slackWebhookUrl: env.slackWebhookUrl, genericWebhookUrl: env.genericWebhookUrl, teamsWebhookUrl: env.teamsWebhookUrl };
  for (const field of WEBHOOK_FIELDS) {
    cfg[field] = _resolveWebhook(stored[field], envMap[field]).url;
  }
  return cfg;
}

// ── save ──────────────────────────────────────────────────────────────────────

// Email-Sektion mergen: leerer Host = löschen (→ ENV); leeres Passwort = behalten.
function _mergeEmail(existing, patch) {
  if (patch === undefined) return existing;
  const host = _trim(patch.host);
  if (host === '') return undefined;
  const pass = _trim(patch.pass) !== ''
    ? encryptSecret(_trim(patch.pass))
    : (existing && existing.pass) || '';
  return {
    host,
    port:   Number(patch.port) || 587,
    secure: patch.secure === true,
    user:   _trim(patch.user),
    from:   _trim(patch.from),
    to:     _trim(patch.to),
    pass,
  };
}

/** Patch speichern; liefert den neuen gespeicherten Zustand.
 *  Webhook-URLs/Passwort sind Secrets: leerer Wert = unverändert (kein Klartext-Round-Trip). */
async function saveNotificationSettings(repo, patch) {
  const stored = await _getStored(repo);
  const next = { ...stored };

  if (typeof patch.outboundEnabled === 'boolean') next.outboundEnabled = patch.outboundEnabled;

  if ('email' in patch) {
    const merged = _mergeEmail(stored.email, patch.email);
    if (merged) next.email = merged; else delete next.email;
  }

  for (const field of WEBHOOK_FIELDS) {
    if (typeof patch[field] === 'string' && patch[field].trim() !== '') {
      next[field] = encryptSecret(patch[field].trim());
    }
  }

  await repo.set(NOTIFICATION_SETTINGS_KEY, next);
  return next;
}

// ── masked ──────────────────────────────────────────────────────────────────

/** Maskierte Sicht fürs Frontend — NIE Passwörter/URLs, nur *Set + Quelle. */
async function maskedNotificationSettings(repo) {
  const stored = await _getStored(repo);
  const env = config.notifications;
  const email = _resolveEmail(stored.email, env.email);
  const envMap = { slackWebhookUrl: env.slackWebhookUrl, genericWebhookUrl: env.genericWebhookUrl, teamsWebhookUrl: env.teamsWebhookUrl };
  const channelId = { slackWebhookUrl: 'slack', genericWebhookUrl: 'webhook', teamsWebhookUrl: 'teams' };

  return {
    outboundEnabled: typeof stored.outboundEnabled === 'boolean' ? stored.outboundEnabled : Boolean(env.outboundEnabled),
    email: {
      host: email.host, port: email.port, secure: email.secure, user: email.user,
      from: email.from, to: email.to, passwordSet: (email.pass || '') !== '', source: email.source,
    },
    channels: WEBHOOK_FIELDS.map((field) => {
      const r = _resolveWebhook(stored[field], envMap[field]);
      return { id: channelId[field], urlSet: r.url !== '', source: r.source };
    }),
  };
}

module.exports = {
  NOTIFICATION_SETTINGS_KEY,
  WEBHOOK_FIELDS,
  resolveNotificationConfig,
  saveNotificationSettings,
  maskedNotificationSettings,
};
