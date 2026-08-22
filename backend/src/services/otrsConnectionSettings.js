'use strict';

// Layer 2 (Frontend-Administrierbarkeit): OTRS/Znuny-Outbound-Verbindung (Base-URL +
// Benutzer + Passwort + Queue/WebService/Operation) aus der DB verwalten statt nur ENV.
// Konvention wie Wazuh/QRadar/CrowdSec/ServiceNow:
//   - DB gewinnt über ENV, ENV bleibt Fail-safe-Fallback,
//   - Passwort AES-256-GCM-verschlüsselt (secretsCrypto), nie Klartext in DB/Log,
//   - nach außen nur maskiert (passwordSet-Boolean + Quelle); Benutzer/Queue/
//     WebService/Operation sind nicht geheim und werden angezeigt.
//
// Outbound-Besonderheit: der OTRSAdapter ist ein Singleton (in externalTicketInstance)
// → eine UI-Änderung wird über den externalTicketConnectionApplier per reconfigure()
// sofort wirksam, ohne Neustart.

const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const OTRS_CONNECTION_KEY = 'integration_otrs';
const DEFAULT_QUEUE       = 'Security';
const DEFAULT_WEB_SERVICE = 'GenericTicketConnectorREST';
const DEFAULT_OPERATION   = 'TicketCreate';
const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const stored = await repo.get(OTRS_CONNECTION_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

/** Effektive Verbindung (DB > ENV) — Passwort entschlüsselt, backend-intern. */
async function resolveOtrsConnection(repo, env = process.env) {
  const stored = await _getStored(repo);
  if (_trim(stored.baseUrl) !== '') {
    return {
      baseUrl:    _trim(stored.baseUrl),
      username:   _trim(stored.username),
      password:   decryptSecret(stored.password || ''),
      queue:      _trim(stored.queue)      || DEFAULT_QUEUE,
      webService: _trim(stored.webService) || DEFAULT_WEB_SERVICE,
      operation:  _trim(stored.operation)  || DEFAULT_OPERATION,
      source:     'db',
    };
  }
  const baseUrl  = _trim(env.OTRS_BASE_URL);
  const username = _trim(env.OTRS_USERNAME);
  const password = env.OTRS_PASSWORD || '';
  const configured = Boolean(baseUrl || username || password);
  return {
    baseUrl, username, password,
    queue:      _trim(env.OTRS_QUEUE)       || DEFAULT_QUEUE,
    webService: _trim(env.OTRS_WEB_SERVICE) || DEFAULT_WEB_SERVICE,
    operation:  _trim(env.OTRS_OPERATION)   || DEFAULT_OPERATION,
    source:     configured ? 'env' : 'none',
  };
}

/** Patch speichern ({ baseUrl, username, password, queue, webService, operation });
 *  leeres Passwort = unverändert; leere URL = löschen (→ ENV). Wirft OTRS_INCOMPLETE,
 *  bevor eine Verbindung ohne Benutzer/Passwort persistiert würde. */
async function saveOtrsConnection(repo, patch) {
  const stored = await _getStored(repo);
  const baseUrl = _trim(patch && patch.baseUrl);

  if (baseUrl === '') {
    if (stored.baseUrl !== undefined) {
      const next = { ...stored };
      delete next.baseUrl; delete next.username; delete next.password;
      delete next.queue; delete next.webService; delete next.operation;
      await repo.set(OTRS_CONNECTION_KEY, next);
    }
    return { baseUrl: '' };
  }

  const username = _trim(patch && patch.username);
  const password = _trim(patch && patch.password) !== ''
    ? encryptSecret(_trim(patch.password))
    : (stored.password || '');
  if (username === '' || password === '') {
    const err = new Error('OTRS: Benutzer und Passwort erforderlich (Passwort wird verschlüsselt gespeichert)');
    err.code = 'OTRS_INCOMPLETE';
    throw err;
  }
  const next = {
    ...stored,
    baseUrl, username, password,
    queue:      _trim(patch && patch.queue)      || DEFAULT_QUEUE,
    webService: _trim(patch && patch.webService) || DEFAULT_WEB_SERVICE,
    operation:  _trim(patch && patch.operation)  || DEFAULT_OPERATION,
  };
  await repo.set(OTRS_CONNECTION_KEY, next);
  return next;
}

/** Maskierte Sicht fürs Frontend — NIE das Passwort, nur passwordSet + Quelle. */
async function maskedOtrsConnection(repo, env = process.env) {
  const c = await resolveOtrsConnection(repo, env);
  return {
    baseUrl: c.baseUrl, username: c.username,
    queue: c.queue, webService: c.webService, operation: c.operation,
    passwordSet: c.password !== '', source: c.source,
  };
}

module.exports = {
  OTRS_CONNECTION_KEY,
  DEFAULT_QUEUE,
  DEFAULT_WEB_SERVICE,
  DEFAULT_OPERATION,
  resolveOtrsConnection,
  saveOtrsConnection,
  maskedOtrsConnection,
};
