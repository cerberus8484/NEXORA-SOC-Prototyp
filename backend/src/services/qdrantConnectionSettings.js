'use strict';

// Layer 2 (Frontend-Administrierbarkeit): Qdrant-Verbindung (URL + optionaler
// API-Key) aus der DB verwalten statt nur ENV. Konvention wie die anderen:
//   - DB gewinnt über ENV, ENV bleibt Fail-safe-Fallback,
//   - API-Key AES-256-GCM-verschlüsselt (secretsCrypto), nie Klartext,
//   - nach außen nur maskiert (apiKeySet-Boolean + Quelle).
// Besonderheit: Qdrant kann OHNE Auth laufen → API-Key ist optional.

const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const QDRANT_CONNECTION_KEY = 'integration_qdrant';
const DEFAULT_URL = 'http://127.0.0.1:6333';
const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const stored = await repo.get(QDRANT_CONNECTION_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

/** Effektive Verbindung (DB > ENV) — Key entschlüsselt, backend-intern. */
async function resolveQdrantConnection(repo) {
  const stored = await _getStored(repo);
  if (_trim(stored.url) !== '') {
    return { url: _trim(stored.url), apiKey: decryptSecret(stored.apiKey || ''), source: 'db' };
  }
  const envUrl = _trim(process.env.QDRANT_URL);
  const envKey = process.env.QDRANT_API_KEY || '';
  if (envUrl !== '') return { url: envUrl, apiKey: envKey, source: 'env' };
  return { url: DEFAULT_URL, apiKey: '', source: 'none' };
}

/** Patch speichern ({ url, apiKey }); leerer Key = unverändert; leere URL = löschen. */
async function saveQdrantConnection(repo, patch) {
  const stored = await _getStored(repo);
  const url = _trim(patch && patch.url);

  if (url === '') {
    if (stored.url !== undefined || stored.apiKey !== undefined) {
      const next = { ...stored };
      delete next.url; delete next.apiKey;
      await repo.set(QDRANT_CONNECTION_KEY, next);
    }
    return { url: '', apiKey: '' };
  }

  const apiKey = _trim(patch && patch.apiKey) !== ''
    ? encryptSecret(_trim(patch.apiKey))
    : (stored.apiKey || '');   // leer = gespeicherten behalten (Key ist optional)
  const next = { ...stored, url, apiKey };
  await repo.set(QDRANT_CONNECTION_KEY, next);
  return next;
}

/** Maskierte Sicht fürs Frontend — NIE den Key, nur apiKeySet + Quelle. */
async function maskedQdrantConnection(repo) {
  const conn = await resolveQdrantConnection(repo);
  return { url: conn.url, apiKeySet: conn.apiKey !== '', source: conn.source };
}

module.exports = {
  QDRANT_CONNECTION_KEY,
  DEFAULT_URL,
  resolveQdrantConnection,
  saveQdrantConnection,
  maskedQdrantConnection,
};
