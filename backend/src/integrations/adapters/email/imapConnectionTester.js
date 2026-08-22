'use strict';

const { ImapFlow } = require('imapflow');
const { classifyConnError } = require('../../http/connErrorClassifier');

// Verbindungstest für die IMAP-Postfach-Verbindung (Layer 2). Verbindet + loggt sich
// ein und trennt sofort wieder — ohne Speichern. Ein Fehlschlag ist ein ERWARTETES
// Ergebnis ({ ok:false, error }), kein Throw. clientFactory ist injizierbar (Tests).

const TEST_TIMEOUT_MS = 4000;

function _defaultFactory(cfg) {
  return new ImapFlow({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.secure,
    auth:   { user: cfg.user, pass: cfg.password },
    logger: false,
    // Bounded — hängender Connect/Greeting darf den Request nicht blockieren.
    connectionTimeout: TEST_TIMEOUT_MS,
    greetingTimeout:   TEST_TIMEOUT_MS,
  });
}

/**
 * Testet eine IMAP-Verbindung (connect + logout), ohne etwas zu speichern.
 * @param {{host:string,port:number,user:string,password:string,secure:boolean}} cfg
 * @param {{clientFactory?:Function}} [opts]
 * @returns {Promise<{ok:boolean, latencyMs:number, reason?:string, error?:string}>}
 */
async function testImapConnection(cfg, { clientFactory = _defaultFactory } = {}) {
  const client = clientFactory(cfg);
  const t0 = Date.now();
  try {
    await client.connect();
    // Verbindung nach erfolgreichem Login sauber schließen; Logout-Fehler ignorieren.
    await client.logout().catch(() => {});
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    // Sicherstellen, dass keine halboffene Verbindung zurückbleibt.
    try { await client.logout(); } catch { /* bereits getrennt */ }
    // Kategorisierter Fehler statt rohem err.message (kein Info-Disclosure interner Topologie).
    return { ok: false, reason: 'error', error: classifyConnError(err), latencyMs: Date.now() - t0 };
  }
}

module.exports = { testImapConnection, TEST_TIMEOUT_MS };
