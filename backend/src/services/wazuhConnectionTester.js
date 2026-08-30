'use strict';

// Verbindungstest für die Wazuh-Verbindung (Layer 2) — eigener Seam, damit Tests
// Fake-Clients injizieren statt echter HTTP-Calls. Ein fehlgeschlagener Ping ist
// ein ERWARTETES Testergebnis (ok:false + Grund), kein 500.

const { WazuhApiClient }     = require('../integrations/adapters/wazuh/WazuhApiClient');
const { WazuhIndexerClient } = require('../integrations/adapters/wazuh/WazuhIndexerClient');
const { RealHttpClient }     = require('../integrations/http/RealHttpClient');
const { classifyConnError }  = require('../integrations/http/connErrorClassifier');

// Kurzer, einheitlicher Timeout für den Test-Pfad. Bewusst niedrig gehalten, damit
// die Antwortlatenz kein "Port offen/geschlossen"-Signal wird (SSRF-Scan-Härtung,
// Security-Review): geschlossener Port → Timeout in TEST_TIMEOUT_MS statt 10-12s.
// TLS-Policy identisch zu den Clients (ENV-global, Lab-Default false).
const TEST_TIMEOUT_MS = 4000;
const _testHttp = () => new RealHttpClient({
  rejectUnauthorized: process.env.WAZUH_TLS_REJECT_UNAUTHORIZED === 'true',
  timeout: TEST_TIMEOUT_MS,
});

const _defaults = {
  api:     (cfg) => new WazuhApiClient({ ...cfg, http: _testHttp() }),
  indexer: (cfg) => new WazuhIndexerClient({ ...cfg, http: _testHttp() }),
};
let _factories = { ..._defaults };

const TARGETS = Object.keys(_defaults);

/** Wirft nie — Fehler werden als { ok:false, error } zurückgegeben. */
async function testConnection(target, cfg) {
  const t0 = Date.now();
  try {
    await _factories[target](cfg).ping();
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    // Kategorisierter Fehler statt rohem err.message (kein Info-Disclosure interner Topologie).
    return { ok: false, latencyMs: Date.now() - t0, error: classifyConnError(err) };
  }
}

// Nur für Tests: Client-Factory ersetzen/zurücksetzen.
function _setFactory(target, fn) { _factories[target] = fn; }
function _resetFactories()       { _factories = { ..._defaults }; }

module.exports = { testConnection, TARGETS, _setFactory, _resetFactories };
