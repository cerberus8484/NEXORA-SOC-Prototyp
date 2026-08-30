'use strict';

const fetch        = require('node-fetch');
const https        = require('https');
const http         = require('http');
const { HttpClient } = require('./HttpClient');

class RealHttpClient extends HttpClient {
  constructor({ timeout = 15_000, rejectUnauthorized = true } = {}) {
    super();
    this._timeout    = timeout;
    this._httpsAgent = new https.Agent({ rejectUnauthorized });
    this._httpAgent  = new http.Agent();
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
