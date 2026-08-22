'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Windows-Server Config-Applier (Cloudbase-Init).
//
// Ablauf (Muster 1:1 wie opnsenseConfigApplier): User-Data-Skript rendern → über
// einen injizierten `deliver`-Kanal in die frisch geklonte VM einspielen (Config-
// Drive). Idempotent über einen stabilen configHash (secret-strippend). Retry bei
// „Gast noch nicht bereit"-Fehlern.
//
// Der `deliver`-Kanal ist injizierbar. Ohne konfigurierten Kanal ist der Default
// FAIL-SAFE: er wirft nicht-retrybar → der Orchestrator rollt kontrolliert zurück,
// statt eine unkonfigurierte Windows-VM als „deployed" zu melden. Der echte Config-
// Drive-Zustellkanal folgt in Slice 6.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { renderWindowsUserData } = require('./windowsServerConfigRenderer');
const { canonical, stripSecrets } = require('../deployDomain');
const { resolveDeployPublicKey } = require('../../services/deployKeypairSettings');

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
 * @param {function} deps.deliver ({ connector, vmid, content, configHash, params, attempt }) → Promise
 */
function makeWindowsServerConfigApplier({ deliver, maxAttempts = 10, delayMs = 3000, deployPublicKeyResolver } = {}) {
  if (typeof deliver !== 'function') throw new Error('makeWindowsServerConfigApplier: deliver erforderlich');
  const resolvePub = typeof deployPublicKeyResolver === 'function' ? deployPublicKeyResolver : resolveDeployPublicKey;

  return async function windowsServerConfigApply(connector, vmid, params) {
    // Nexora-Deploy-Public-Key (PUBLIC) → authorized_keys (Update-Zugang, Slice 6e).
    // Best-effort: fehlt das Keypair, wird kein Key provisioniert (Update-Zugang später).
    let deployPublicKey = null;
    try { deployPublicKey = await resolvePub(); } catch { deployPublicKey = null; }
    const content = renderWindowsUserData(params, { deployPublicKey }); // wirft bei ungültigem/injiziertem Wert
    const configHash = computeConfigHash(params);

    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await deliver({ connector, vmid, content, configHash, params, attempt });
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt >= maxAttempts) throw err;
        await sleep(delayMs);
      }
    }
    throw lastErr || new Error('Windows-Server-Config-Apply fehlgeschlagen');
  };
}

// Fail-safe Default: kein Gast-Zustellkanal → wirft nicht-retrybar (kein stiller Erfolg).
function defaultDeliver() {
  const e = new Error('Windows-Server-Config-Delivery nicht konfiguriert — kein Config-Drive-Kanal (folgt Slice 6)');
  e.retryable = false;
  throw e;
}

const windowsServerConfigApplier = makeWindowsServerConfigApplier({ deliver: defaultDeliver, maxAttempts: 1 });

module.exports = { makeWindowsServerConfigApplier, windowsServerConfigApplier, computeConfigHash };
