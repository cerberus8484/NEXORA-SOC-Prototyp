'use strict';

// Layer 2 (Frontend-Administrierbarkeit): Wazuh-Verbindung (API + Indexer) aus der
// DB verwalten statt nur ENV. Regeln:
//   - DB-Sektion gewinnt, wenn deren URL gesetzt ist; sonst ENV-Fallback
//     (Boot-Automatisierung/Fresh-Install bricht nicht).
//   - Passwörter liegen NIE im Klartext in der DB → secretsCrypto (AES-256-GCM),
//     dasselbe Muster wie die Cloud-LLM-API-Keys.
//   - Nach außen (GET) nur maskiert: passwordSet-Boolean statt Wert.
//
// Gespeichert wird EIN Settings-Key (atomar): { api: {...}, indexer: {...} }.

const config = require('../config');
const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const WAZUH_CONNECTION_KEY = 'integration_wazuh';

// ── intern ────────────────────────────────────────────────────────────────────

const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const stored = await repo.get(WAZUH_CONNECTION_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

// Eine Sektion (api|indexer) auflösen: DB gewinnt, wenn URL gesetzt; sonst ENV.
function _resolveSection(storedSection, envSection) {
  if (storedSection && _trim(storedSection.url) !== '') {
    return {
      url:      _trim(storedSection.url),
      user:     _trim(storedSection.user),
      password: decryptSecret(storedSection.password || ''),
      source:   'db',
    };
  }
  const envConfigured = Boolean(envSection.url || envSection.user || envSection.password);
  return {
    url:      envSection.url || '',
    user:     envSection.user || '',
    password: envSection.password || '',
    source:   envConfigured ? 'env' : 'none',
  };
}

// Save-Semantik pro Sektion:
//   - Patch-Sektion fehlt        → unverändert.
//   - Patch-URL leer             → Sektion komplett löschen (keine Creds-Leiche in DB).
//   - Patch-Passwort leer        → gespeichertes Passwort behalten.
//   - Patch-Passwort nicht leer  → verschlüsselt ersetzen.
function _mergeSection(existing, patch) {
  if (patch === undefined) return existing;                 // nicht angefasst
  const url = _trim(patch && patch.url);
  if (url === '') return undefined;                          // löschen → ENV-Fallback
  const password = _trim(patch && patch.password) !== ''
    ? encryptSecret(_trim(patch.password))
    : (existing && existing.password) || '';
  return { url, user: _trim(patch && patch.user), password };
}

// ── öffentlich ────────────────────────────────────────────────────────────────

/** Effektive Verbindung (DB > ENV) — Passwörter entschlüsselt, nur backend-intern nutzen. */
async function resolveWazuhConnection(repo) {
  const stored = await _getStored(repo);
  return {
    api: _resolveSection(stored.api, config.wazuhApi),
    indexer: {
      ..._resolveSection(stored.indexer, config.wazuhIndexer),
      // Index-Patterns bleiben Config/ENV (kein UI-Feld — bewusst schlank).
      index:     config.wazuhIndexer.index,
      vulnIndex: config.wazuhIndexer.vulnIndex,
    },
  };
}

// Eine gespeicherte Sektion MUSS vollständig sein (URL+User+Passwort): die DB
// gewinnt über ENV — eine halbe Sektion würde die laufende Verbindung brechen.
function _assertComplete(name, section) {
  if (!section) return;
  if (section.user !== '' && section.password !== '') return;
  const err = new Error(`Wazuh-${name}: Benutzer und Passwort erforderlich (Passwort wird verschlüsselt gespeichert)`);
  err.code = 'WAZUH_SECTION_INCOMPLETE';
  throw err;
}

/** Patch speichern ({ api?, indexer? }); liefert den neuen gespeicherten Zustand.
 *  Wirft WAZUH_SECTION_INCOMPLETE, bevor irgendetwas persistiert wird. */
async function saveWazuhConnection(repo, patch) {
  const stored = await _getStored(repo);
  const next = {};
  const api     = _mergeSection(stored.api,     patch && patch.api);
  const indexer = _mergeSection(stored.indexer, patch && patch.indexer);
  _assertComplete('API',     api);
  _assertComplete('Indexer', indexer);
  if (api)     next.api     = api;
  if (indexer) next.indexer = indexer;
  await repo.set(WAZUH_CONNECTION_KEY, next);
  return next;
}

/** Maskierte Sicht fürs Frontend — NIE Passwörter, nur passwordSet + Quelle. */
async function maskedWazuhConnection(repo) {
  const conn = await resolveWazuhConnection(repo);
  const mask = (s) => ({ url: s.url, user: s.user, passwordSet: s.password !== '', source: s.source });
  return { api: mask(conn.api), indexer: mask(conn.indexer) };
}

module.exports = {
  WAZUH_CONNECTION_KEY,
  resolveWazuhConnection,
  saveWazuhConnection,
  maskedWazuhConnection,
};
