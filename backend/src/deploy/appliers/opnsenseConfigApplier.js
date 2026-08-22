'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — OPNsense config-Applier (configApplier-Vertrag).
//
// Signatur (vom Orchestrator aufgerufen): (connector, vmid, params) → Promise.
// Ablauf: config.xml rendern → über einen injizierten `deliver`-Kanal in die
// laufende VM einspielen. Idempotent über einen stabilen configHash (ein
// idempotenter First-Boot-Importer erkennt „schon angewendet"); Retry mit
// Backoff, solange der Gast-Agent/die API noch nicht bereit ist; ein harter
// Fehler wirft → der Orchestrator rollt kontrolliert zurück.
//
// Der `deliver`-Kanal ist bewusst injizierbar: die konkrete Zustellung in den
// Gast (First-Boot-Drive / OPNsense-config-import-API) ist umgebungsspezifisch
// und wird vom Operator konfiguriert. Ohne konfigurierten deliver ist der
// Default fail-safe (wirft) — KEIN stiller „deployed ohne Konfiguration".
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { renderConfigXml } = require('./opnsenseConfigRenderer');
const { canonical, stripSecrets } = require('../deployDomain');

function computeConfigHash(params) {
  return crypto.createHash('sha256').update(canonical(stripSecrets(params || {}))).digest('hex');
}

function isRetryable(err) {
  if (!err) return false;
  if (err.retryable === true) return true;
  return /not ready|agent|timeout|ECONNREFUSED|starting/i.test(String(err.message || ''));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * @param {object} deps
 * @param {function} deps.deliver ({ connector, vmid, xml, configHash, params, attempt }) → Promise
 * @param {number} [deps.maxAttempts=10]
 * @param {number} [deps.delayMs=3000]
 */
function makeOpnsenseConfigApplier({ deliver, maxAttempts = 10, delayMs = 3000 } = {}) {
  if (typeof deliver !== 'function') throw new Error('makeOpnsenseConfigApplier: deliver erforderlich');

  return async function opnsenseConfigApply(connector, vmid, params) {
    const xml = renderConfigXml(params);
    const configHash = computeConfigHash(params);

    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await deliver({ connector, vmid, xml, configHash, params, attempt });
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt >= maxAttempts) throw err;
        // eslint-disable-next-line no-await-in-loop
        await sleep(delayMs);
      }
    }
    throw lastErr || new Error('OPNsense-config-Apply fehlgeschlagen');
  };
}

// Fail-safe Default-Zustellung: keine echte Gast-Zustellung konfiguriert → wirft.
// Verhindert ein stilles „deployed, aber unkonfiguriert". Der Operator wählt eine
// echte deliver-Strategie (First-Boot-Drive / config-import-API) — siehe Runbook.
function defaultDeliver() {
  const e = new Error('OPNsense-Config-Delivery nicht konfiguriert — kein Gast-Zustellkanal hinterlegt');
  e.retryable = false;
  throw e;
}

const opnsenseConfigApplier = makeOpnsenseConfigApplier({ deliver: defaultDeliver, maxAttempts: 1 });

module.exports = { makeOpnsenseConfigApplier, opnsenseConfigApplier, computeConfigHash };
