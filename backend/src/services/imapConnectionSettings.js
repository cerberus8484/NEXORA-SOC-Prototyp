'use strict';

// Layer 2 (Frontend-Administrierbarkeit): IMAP-Postfach-Verbindung (Host/Port/User/
// Passwort/TLS) aus der DB verwalten statt nur ENV. Konvention wie die anderen
// Integrationen: DB > ENV, ENV Fail-safe-Fallback, Passwort AES-256-GCM-verschlüsselt,
// nach außen nur maskiert.
//
// Besonderheit wie CrowdSec: IMAP ist ein Boot-POLLER. Der Poller löst diese Config
// pro Zyklus auf (kein Applier) → eine UI-Änderung greift beim nächsten Poll-Lauf
// (≤ Poll-Intervall), ohne Prozess-Neustart.

const { encryptSecret, decryptSecret } = require('../config/secretsCrypto');

const IMAP_CONNECTION_KEY = 'integration_imap';
const DEFAULT_PORT = 993;
const _trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function _getStored(repo) {
  const stored = await repo.get(IMAP_CONNECTION_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

/** Effektive Verbindung (DB > ENV) — Passwort entschlüsselt, backend-intern.
 *  secure default true (impliziter TLS auf 993). */
async function resolveImapConnection(repo, env = process.env) {
  const stored = await _getStored(repo);
  if (_trim(stored.host) !== '') {
    return {
      host: _trim(stored.host),
      port: Number(stored.port) || DEFAULT_PORT,
      user: _trim(stored.user),
      password: decryptSecret(stored.password || ''),
      secure: stored.secure !== false,
      source: 'db',
    };
  }
  const host = _trim(env.IMAP_HOST);
  const user = _trim(env.IMAP_USER);
  const password = env.IMAP_PASSWORD || '';
  const configured = Boolean(host || user || password);
  return {
    host,
    port: Number(env.IMAP_PORT) || DEFAULT_PORT,
    user,
    password,
    // TLS-Default an; per IMAP_TLS=false abschaltbar (STARTTLS/Klartext-Port).
    secure: env.IMAP_TLS ? env.IMAP_TLS !== 'false' : true,
    source: configured ? 'env' : 'none',
  };
}

/** Patch speichern ({ host, port, user, password, secure }); leeres Passwort =
 *  unverändert; leerer Host = Sektion löschen (→ ENV). Wirft IMAP_INCOMPLETE ohne
 *  User/Passwort. */
async function saveImapConnection(repo, patch) {
  const stored = await _getStored(repo);
  const host = _trim(patch && patch.host);

  if (host === '') {
    if (stored.host !== undefined) {
      const next = { ...stored };
      delete next.host; delete next.port; delete next.user; delete next.password; delete next.secure;
      await repo.set(IMAP_CONNECTION_KEY, next);
    }
    return { host: '' };
  }

  const user = _trim(patch && patch.user);
  const password = _trim(patch && patch.password) !== ''
    ? encryptSecret(_trim(patch.password))
    : (stored.password || '');
  if (user === '' || password === '') {
    const err = new Error('IMAP: Benutzer und Passwort erforderlich (Passwort wird verschlüsselt gespeichert)');
    err.code = 'IMAP_INCOMPLETE';
    throw err;
  }
  const port = Number(patch && patch.port) || DEFAULT_PORT;
  // secure default true; nur explizites false schaltet TLS ab.
  const secure = (patch && patch.secure) !== false;
  const next = { ...stored, host, port, user, password, secure };
  await repo.set(IMAP_CONNECTION_KEY, next);
  return next;
}

/** Maskierte Sicht fürs Frontend — NIE das Passwort, nur passwordSet + Quelle. */
async function maskedImapConnection(repo, env = process.env) {
  const c = await resolveImapConnection(repo, env);
  return { host: c.host, port: c.port, user: c.user, secure: c.secure, passwordSet: c.password !== '', source: c.source };
}

module.exports = {
  IMAP_CONNECTION_KEY,
  resolveImapConnection,
  saveImapConnection,
  maskedImapConnection,
};
