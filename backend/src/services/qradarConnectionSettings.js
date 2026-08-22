'use strict';

// Layer 2 (Frontend-Administrierbarkeit): QRadar-Verbindung (Base-URL + API-Token)
// aus der DB verwalten statt nur ENV. Konvention wie Wazuh-Verbindung:
//   - DB gewinnt über ENV, ENV bleibt Fail-safe-Fallback,
//   - Token AES-256-GCM-verschlüsselt (secretsCrypto), nie Klartext in DB/Log,
//   - nach außen nur maskiert (tokenSet-Boolean + Quelle).

const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const QRADAR_CONNECTION_KEY = 'integration_qradar';
const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const stored = await repo.get(QRADAR_CONNECTION_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

/** Effektive Verbindung (DB > ENV) — Token entschlüsselt, backend-intern. */
async function resolveQradarConnection(repo) {
  const stored = await _getStored(repo);
  if (_trim(stored.baseUrl) !== '') {
    return { baseUrl: _trim(stored.baseUrl), token: decryptSecret(stored.token || ''), source: 'db' };
  }
  const envUrl = process.env.QRADAR_BASE_URL || '';
  const envToken = process.env.QRADAR_TOKEN || '';
  const configured = Boolean(envUrl || envToken);
  return { baseUrl: envUrl, token: envToken, source: configured ? 'env' : 'none' };
}

/** Patch speichern ({ baseUrl, token }); leerer Token = unverändert; leere URL = löschen.
 *  Wirft QRADAR_INCOMPLETE, bevor eine Sektion ohne Token persistiert würde. */
async function saveQradarConnection(repo, patch) {
  const stored = await _getStored(repo);
  const baseUrl = _trim(patch && patch.baseUrl);

  if (baseUrl === '') {
    // Sektion löschen → ENV-Fallback.
    if (stored.baseUrl !== undefined || stored.token !== undefined) {
      const next = { ...stored };
      delete next.baseUrl; delete next.token;
      await repo.set(QRADAR_CONNECTION_KEY, next);
    }
    return { baseUrl: '', token: '' };
  }

  const token = _trim(patch && patch.token) !== ''
    ? encryptSecret(_trim(patch.token))
    : (stored.token || '');
  if (token === '') {
    const err = new Error('QRadar: API-Token erforderlich (wird verschlüsselt gespeichert)');
    err.code = 'QRADAR_INCOMPLETE';
    throw err;
  }
  const next = { ...stored, baseUrl, token };
  await repo.set(QRADAR_CONNECTION_KEY, next);
  return next;
}

/** Maskierte Sicht fürs Frontend — NIE den Token, nur tokenSet + Quelle. */
async function maskedQradarConnection(repo) {
  const conn = await resolveQradarConnection(repo);
  return { baseUrl: conn.baseUrl, tokenSet: conn.token !== '', source: conn.source };
}

module.exports = {
  QRADAR_CONNECTION_KEY,
  resolveQradarConnection,
  saveQradarConnection,
  maskedQradarConnection,
};
