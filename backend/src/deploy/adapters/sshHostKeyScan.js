'use strict';

// ─────────────────────────────────────────────────────────────────────────
// SSH-Host-Key-Scan — liest den SSH-Host-Key eines Ziel-Hosts und berechnet den
// Pin (SHA-256 des Server-Key-Buffers, hex). IDENTISCH zur Pin-Bildung in
// sshExecRunner (sha256(keyBuf)), damit ein gescannter Pin exakt das ist, was der
// Update-Runner später verifiziert.
//
// Zweck (Slice 6, Option 1 „Auto-Capture" + Option 2 „Arm-Confirm"): direkt nach dem
// Deploy bzw. beim Scharfschalten-für-Updates den authentischen Host-Key der frisch
// erzeugten VM erfassen und pinnen — danach ist der Update-Pfad fail-closed (kein TOFU).
//
// Der Scan AUTHENTIFIZIERT sich NICHT — er erfasst den Key im hostVerifier und bricht
// die Verbindung sofort ab. Kein Key/Secret nötig. SSRF-Guard: Loopback/Metadaten tabu.
// Der ssh2-Client ist injizierbar (ClientCtor) → unit-testbar ohne echten Server.
// ─────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { isBlockedSsrfHost } = require('../../integrations/http/internalUrlAllowlist');

const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;
const DEFAULT_TIMEOUT_MS = 5000;

class HostKeyScanError extends Error {
  constructor(message, code = 'HOSTKEY_SCAN_ERROR') { super(message); this.name = 'HostKeyScanError'; this.code = code; }
}

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/**
 * @param {object} p
 * @param {string} p.host        Ziel-Host (IP/DNS) — kein Loopback/Metadaten.
 * @param {number} [p.port=22]
 * @param {number} [p.timeoutMs=5000]
 * @param {Function} [p.ClientCtor]  ssh2.Client (Default) — injizierbar für Tests.
 * @returns {Promise<string>} SHA-256-Hostkey-Pin (hex, lowercase)
 */
function scanHostKeyPin({ host, port = 22, timeoutMs = DEFAULT_TIMEOUT_MS, ClientCtor } = {}) {
  return new Promise((resolve, reject) => {
    const h = String(host || '');
    if (!HOST_RE.test(h)) return reject(new HostKeyScanError('ungültiger host', 'E_BAD_HOST'));
    if (isBlockedSsrfHost(h)) return reject(new HostKeyScanError('Host nicht erlaubt (Loopback/Metadaten)', 'E_BLOCKED'));
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return reject(new HostKeyScanError('ungültiger port', 'E_BAD_PORT'));

    const Client = ClientCtor || require('ssh2').Client;
    const conn = new Client();
    let pin = null;
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { conn.end(); } catch { /* egal */ }
      try { conn.destroy(); } catch { /* egal */ }
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new HostKeyScanError('Zeitüberschreitung beim Host-Key-Scan', 'E_TIMEOUT')), timeoutMs);

    // hostVerifier feuert VOR der Auth → Key erfassen, Pin bilden, Verbindung ablehnen.
    // Danach emittiert ssh2 'error' (Host-Key abgelehnt) → wir lösen mit dem erfassten Pin auf.
    conn.on('error', () => (pin ? finish(resolve, pin) : finish(reject, new HostKeyScanError('Host-Key-Scan fehlgeschlagen', 'E_SCAN_FAILED'))));
    conn.on('close', () => (pin ? finish(resolve, pin) : undefined));

    try {
      conn.connect({
        host: h, port: p, username: 'nexora-hostkeyscan', readyTimeout: timeoutMs,
        hostVerifier: (keyBuf, cb) => { pin = sha256Hex(keyBuf); cb(false); },
      });
    } catch (e) {
      finish(reject, new HostKeyScanError('Host-Key-Scan fehlgeschlagen', 'E_SCAN_FAILED'));
    }
  });
}

module.exports = { scanHostKeyPin, HostKeyScanError, sha256Hex };
