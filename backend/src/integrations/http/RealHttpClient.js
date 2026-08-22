'use strict';

const fetch        = require('node-fetch');
const https        = require('https');
const http         = require('http');
const tls          = require('tls');
const { HttpClient } = require('./HttpClient');
const { createSsrfSafeLookup } = require('./internalUrlAllowlist');

// ─────────────────────────────────────────────────────────────────────────
// Fingerprint-Pinning-Agent.
//
// Warum nicht `ca: leafPem` + rejectUnauthorized? Der Proxmox-Node-Leaf ist von der
// PVE Cluster Manager CA signiert (NICHT selbstsigniert), und PVE sendet nur den Leaf.
// OpenSSL kann die Leaf-Signatur ohne die CA nicht prüfen → UNABLE_TO_VERIFY_LEAF_SIGNATURE,
// Abbruch VOR jeder checkServerIdentity-Prüfung. (Empirisch gegen beide echten PVE-Nodes
// bestätigt.)
//
// Deshalb: PKI-Chain-Prüfung aus (rejectUnauthorized:false) — ABER als Ersatz ein
// EXAKTER SHA-256-Fingerprint-Abgleich auf Socket-Ebene. Es wird ausschließlich genau
// EIN Zertifikat akzeptiert; jedes andere (Rotation/MITM/fremdes Cert) trennt die
// Verbindung sofort (fail-closed). Das ist echtes Pinning, kein „alles akzeptieren".
// ─────────────────────────────────────────────────────────────────────────
class PinnedHttpsAgent extends https.Agent {
  constructor({ pinnedFingerprint, lookup } = {}) {
    super();
    // Defensiv: dieser Agent schaltet die Chain-Prüfung ab und darf NUR mit einem
    // echten Pin existieren. Ohne Pin gäbe es keinen Trust-Anchor → fail-closed werfen,
    // statt sich auf die Disziplin des Aufrufers zu verlassen (kein „undefined"-Pin).
    if (!pinnedFingerprint || typeof pinnedFingerprint !== 'string') {
      throw new Error('PinnedHttpsAgent: pinnedFingerprint (SHA-256) erforderlich');
    }
    this._pin = pinnedFingerprint;
    this._lookup = lookup;
  }

  createConnection(options, callback) {
    const socket = tls.connect({
      ...options,
      servername: undefined,       // kein SNI mit IP (RFC 6066) — der Pin IST die Identität
      rejectUnauthorized: false,   // Chain-Prüfung aus (Leaf ohne CA nicht validierbar) …
      lookup: this._lookup,
    });
    socket.once('secureConnect', () => {
      // … dafür GENAU dieser Fingerprint. Kein Cert / Abweichung ⇒ sofort trennen.
      const cert = socket.getPeerCertificate();
      const fp = cert && cert.fingerprint256;
      if (!fp || fp !== this._pin) {
        socket.destroy(new Error('CERT_PIN_MISMATCH: Server-Zertifikat weicht vom gespeicherten Fingerprint ab'));
      }
    });
    if (typeof callback === 'function') callback(null, socket);
    return socket;
  }
}

class RealHttpClient extends HttpClient {
  constructor({ timeout = 15_000, rejectUnauthorized = true, ssrfProtection = false, pinnedFingerprint } = {}) {
    super();
    this._timeout    = timeout;
    const lookup = ssrfProtection ? createSsrfSafeLookup() : undefined;
    // Pin gesetzt → exakte Fingerprint-Pinnung. NUR dann wird die Chain-Prüfung
    // ausgeschaltet — und auch dann wird ausschließlich genau ein Zertifikat akzeptiert.
    // Ohne Pin bleibt die sichere Default (rejectUnauthorized) unverändert.
    this._httpsAgent = pinnedFingerprint
      ? new PinnedHttpsAgent({ pinnedFingerprint, lookup })
      : new https.Agent({ rejectUnauthorized, lookup });
    this._httpAgent  = new http.Agent({ lookup });
  }

  async request(url, { method = 'GET', headers = {}, body = null } = {}) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      // Agent passend zum Protokoll wählen: http:// (z.B. Ollama) braucht einen
      // http.Agent — ein https.Agent würde die Verbindung scheitern lassen.
      agent: (parsedURL) => (parsedURL.protocol === 'http:' ? this._httpAgent : this._httpsAgent),
      timeout: this._timeout,
      // SSRF-/Credential-Härtung: 3xx NICHT automatisch folgen. node-fetch würde sonst
      // den Authorization-Header transparent an ein vom Server gewähltes Redirect-Ziel
      // (z.B. http://169.254.169.254/, interne Hosts) weiterreichen. Adapter sollen sich
      // explizit neu verbinden, nicht blind folgen.
      redirect: 'error',
    };
    if (body) options.body = typeof body === 'string' ? body : JSON.stringify(body);

    const res  = await fetch(url, options);
    const text = await res.text();

    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${res.statusText}`);
      err.status   = res.status;
      err.response = data;
      throw err;
    }
    return { status: res.status, data };
  }
}

module.exports = { RealHttpClient };
