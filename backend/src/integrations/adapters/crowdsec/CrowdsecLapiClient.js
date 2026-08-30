'use strict';

// CrowdsecLapiClient — holt WAN-Alerts vom Webserver-CrowdSec über die Local API (LAPI).
//
// /v1/alerts erfordert Machine-Auth: POST /v1/watchers/login {machine_id,password}
// liefert ein kurzlebiges JWT, das als Bearer für /v1/alerts genutzt wird.
//
// Transportunabhängig: bekommt einen HttpClient injiziert (RealHttpClient-Vertrag
// request(url,{method,headers,body}) -> {status,data}, wirft bei non-2xx mit .status).
// Credentials kommen vom Aufrufer (nur aus ENV, nie aus dem Repo).

// Sicherheitspuffer: Token kurz vor Ablauf erneuern, statt erst beim 401.
const TOKEN_SKEW_MS = 30_000;

class CrowdsecLapiClient {
  /**
   * @param {object}   opts
   * @param {string}   opts.baseUrl    LAPI-Basis, z.B. https://web.example:8080
   * @param {string}   opts.machineId  registrierte Machine-ID (cscli machines add)
   * @param {string}   opts.password   Machine-Passwort
   * @param {object}   opts.httpClient HttpClient mit request(url, opts)
   */
  constructor({ baseUrl, machineId, password, httpClient } = {}) {
    this._baseUrl   = (baseUrl || '').replace(/\/+$/, '');
    this._machineId = machineId || '';
    this._password  = password || '';
    this._http      = httpClient;
    this._token     = null;
    this._expiresAt = 0;
  }

  isConfigured() {
    return Boolean(this._baseUrl && this._machineId && this._password && this._http);
  }

  /** Holt ein frisches JWT von der LAPI. Gibt den Token zurück. Wirft bei Fehler. */
  async login() {
    const res = await this._http.request(`${this._baseUrl}/v1/watchers/login`, {
      method: 'POST',
      body:   { machine_id: this._machineId, password: this._password },
    });
    const token = res && res.data && res.data.token;
    if (!token) throw new Error('CrowdSec-LAPI-Login lieferte kein Token');
    this._token     = token;
    this._expiresAt = this._parseExpiry(res.data.expire);
    return token;
  }

  /**
   * Holt Alerts von /v1/alerts. Optional `since` (z.B. "2h" oder ISO-Zeit) als Query.
   * Bei 401 wird genau einmal neu eingeloggt und erneut versucht.
   * @returns {Promise<object[]>} rohe CrowdSec-Alert-Objekte (für CrowdsecAdapter)
   */
  async fetchAlerts({ since } = {}) {
    await this._ensureToken();
    const url = `${this._baseUrl}/v1/alerts` + (since ? `?since=${encodeURIComponent(since)}` : '');
    try {
      return this._asArray(await this._getWithToken(url));
    } catch (err) {
      if (err && err.status === 401) {
        this._token = null;                 // Token verworfen → frisch einloggen
        await this._ensureToken();
        return this._asArray(await this._getWithToken(url));
      }
      throw err;                            // andere Fehler nicht verschlucken
    }
  }

  // ── intern ─────────────────────────────────────────────────────────────────

  async _ensureToken() {
    if (!this._token || Date.now() >= this._expiresAt - TOKEN_SKEW_MS) {
      await this.login();
    }
  }

  async _getWithToken(url) {
    const res = await this._http.request(url, {
      method:  'GET',
      headers: { Authorization: `Bearer ${this._token}` },
    });
    return res && res.data;
  }

  _asArray(data) {
    return Array.isArray(data) ? data : [];
  }

  _parseExpiry(expire) {
    const ts = expire ? Date.parse(expire) : NaN;
    return Number.isFinite(ts) ? ts : Date.now() + 3_600_000; // Fallback: 1h
  }
}

module.exports = { CrowdsecLapiClient };
