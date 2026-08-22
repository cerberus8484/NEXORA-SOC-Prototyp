'use strict';

// Layer 2 (Frontend-Administrierbarkeit): ServiceNow-Outbound-Verbindung (Base-URL +
// Benutzer + Passwort + Table) aus der DB verwalten statt nur ENV. Konvention wie
// Wazuh/QRadar/CrowdSec:
//   - DB gewinnt über ENV, ENV bleibt Fail-safe-Fallback,
//   - Passwort AES-256-GCM-verschlüsselt (secretsCrypto), nie Klartext in DB/Log,
//   - nach außen nur maskiert (passwordSet-Boolean + Quelle); Benutzer/Table sind
//     nicht geheim und werden angezeigt.
//
// Outbound-Besonderheit ggü. den Poller-Integrationen: der ServiceNowAdapter ist ein
// Singleton (in externalTicketInstance) → eine UI-Änderung wird über den
// externalTicketConnectionApplier per reconfigure() sofort wirksam, ohne Neustart.

const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const SERVICENOW_CONNECTION_KEY = 'integration_servicenow';
const DEFAULT_TABLE = 'incident';
const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const stored = await repo.get(SERVICENOW_CONNECTION_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

/** Effektive Verbindung (DB > ENV) — Passwort entschlüsselt, backend-intern. */
async function resolveServicenowConnection(repo, env = process.env) {
  const stored = await _getStored(repo);
  if (_trim(stored.baseUrl) !== '') {
    return {
      baseUrl:  _trim(stored.baseUrl),
      username: _trim(stored.username),
      password: decryptSecret(stored.password || ''),
      table:    _trim(stored.table) || DEFAULT_TABLE,
      source:   'db',
    };
  }
  const baseUrl  = _trim(env.SERVICENOW_BASE_URL);
  const username = _trim(env.SERVICENOW_USERNAME);
  const password = env.SERVICENOW_PASSWORD || '';
  const configured = Boolean(baseUrl || username || password);
  return {
    baseUrl, username, password,
    table:  _trim(env.SERVICENOW_TABLE) || DEFAULT_TABLE,
    source: configured ? 'env' : 'none',
  };
}

/** Patch speichern ({ baseUrl, username, password, table }); leeres Passwort =
 *  unverändert; leere URL = löschen (→ ENV). Wirft SERVICENOW_INCOMPLETE, bevor eine
 *  Verbindung ohne Benutzer/Passwort persistiert würde. */
async function saveServicenowConnection(repo, patch) {
  const stored = await _getStored(repo);
  const baseUrl = _trim(patch && patch.baseUrl);

  if (baseUrl === '') {
    if (stored.baseUrl !== undefined) {
      const next = { ...stored };
      delete next.baseUrl; delete next.username; delete next.password; delete next.table;
      await repo.set(SERVICENOW_CONNECTION_KEY, next);
    }
    return { baseUrl: '' };
  }

  const username = _trim(patch && patch.username);
  const password = _trim(patch && patch.password) !== ''
    ? encryptSecret(_trim(patch.password))
    : (stored.password || '');
  if (username === '' || password === '') {
    const err = new Error('ServiceNow: Benutzer und Passwort erforderlich (Passwort wird verschlüsselt gespeichert)');
    err.code = 'SERVICENOW_INCOMPLETE';
    throw err;
  }
  const next = { ...stored, baseUrl, username, password, table: _trim(patch && patch.table) || DEFAULT_TABLE };
  await repo.set(SERVICENOW_CONNECTION_KEY, next);
  return next;
}

/** Maskierte Sicht fürs Frontend — NIE das Passwort, nur passwordSet + Quelle. */
async function maskedServicenowConnection(repo, env = process.env) {
  const c = await resolveServicenowConnection(repo, env);
  return { baseUrl: c.baseUrl, username: c.username, table: c.table, passwordSet: c.password !== '', source: c.source };
}

module.exports = {
  SERVICENOW_CONNECTION_KEY,
  DEFAULT_TABLE,
  resolveServicenowConnection,
  saveServicenowConnection,
  maskedServicenowConnection,
};
