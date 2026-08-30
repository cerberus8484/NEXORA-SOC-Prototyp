'use strict';

// Layer 2 (Frontend-Administrierbarkeit): CrowdSec-LAPI-Verbindung aus der DB
// verwalten statt nur ENV. Konvention wie die anderen: DB > ENV, ENV Fail-safe-
// Fallback, Passwort AES-256-GCM-verschlüsselt, nach außen nur maskiert.
//
// Besonderheit ggü. den Client-Integrationen: CrowdSec ist ein Boot-POLLER. Der
// Poller löst diese Config pro Zyklus auf (kein Applier) → eine UI-Änderung greift
// beim nächsten Poll-Lauf (≤ Poll-Intervall), ohne Prozess-Neustart.

const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const CROWDSEC_CONNECTION_KEY = 'integration_crowdsec';
const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const stored = await repo.get(CROWDSEC_CONNECTION_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

/** Effektive Verbindung (DB > ENV) — Passwort entschlüsselt, backend-intern.
 *  since/intervalMs bleiben ENV/Default (nicht UI-verwaltet — bewusst schlank). */
async function resolveCrowdsecConnection(repo, env = process.env) {
  const stored = await _getStored(repo);
  if (_trim(stored.baseUrl) !== '') {
    return {
      baseUrl: _trim(stored.baseUrl),
      machineId: _trim(stored.machineId),
      password: decryptSecret(stored.password || ''),
      tlsInsecure: stored.tlsInsecure === true,
      source: 'db',
    };
  }
  const baseUrl = _trim(env.CROWDSEC_LAPI_URL);
  const machineId = _trim(env.CROWDSEC_MACHINE_ID);
  const password = env.CROWDSEC_PASSWORD || '';
  const configured = Boolean(baseUrl || machineId || password);
  return {
    baseUrl, machineId, password,
    tlsInsecure: env.CROWDSEC_TLS_INSECURE === 'true',
    source: configured ? 'env' : 'none',
  };
}

/** Patch speichern ({ baseUrl, machineId, password, tlsInsecure }); leeres Passwort =
 *  unverändert; leere URL = löschen. Wirft CROWDSEC_INCOMPLETE ohne MachineID/Passwort. */
async function saveCrowdsecConnection(repo, patch) {
  const stored = await _getStored(repo);
  const baseUrl = _trim(patch && patch.baseUrl);

  if (baseUrl === '') {
    if (stored.baseUrl !== undefined) {
      const next = { ...stored };
      delete next.baseUrl; delete next.machineId; delete next.password; delete next.tlsInsecure;
      await repo.set(CROWDSEC_CONNECTION_KEY, next);
    }
    return { baseUrl: '' };
  }

  const machineId = _trim(patch && patch.machineId);
  const password = _trim(patch && patch.password) !== ''
    ? encryptSecret(_trim(patch.password))
    : (stored.password || '');
  if (machineId === '' || password === '') {
    const err = new Error('CrowdSec: Machine-ID und Passwort erforderlich (Passwort wird verschlüsselt gespeichert)');
    err.code = 'CROWDSEC_INCOMPLETE';
    throw err;
  }
  const next = { ...stored, baseUrl, machineId, password, tlsInsecure: (patch && patch.tlsInsecure) === true };
  await repo.set(CROWDSEC_CONNECTION_KEY, next);
  return next;
}

/** Maskierte Sicht fürs Frontend — NIE das Passwort, nur passwordSet + Quelle. */
async function maskedCrowdsecConnection(repo, env = process.env) {
  const c = await resolveCrowdsecConnection(repo, env);
  return { baseUrl: c.baseUrl, machineId: c.machineId, tlsInsecure: c.tlsInsecure, passwordSet: c.password !== '', source: c.source };
}

module.exports = {
  CROWDSEC_CONNECTION_KEY,
  resolveCrowdsecConnection,
  saveCrowdsecConnection,
  maskedCrowdsecConnection,
};
