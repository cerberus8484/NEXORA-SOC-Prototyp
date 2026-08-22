'use strict';

const { RealHttpClient } = require('../integrations/http/RealHttpClient');

const DEFAULT_URL = 'http://127.0.0.1:6333';

// Layer 2: modulweite Runtime-Config (DB > ENV), vom qdrantConnectionApplier beim
// Boot und nach jedem PUT gesetzt. Live gelesen → auch bereits erzeugte Instanzen
// (z.B. in agentServiceInstance beim Modul-Load) übernehmen eine UI-Änderung ohne
// Neustart. Präzedenz: explizite Ctor-Args (Tests) > Runtime (DB) > ENV > Default.
const _runtime = { url: '', apiKey: '' };

/** Effektive Verbindung (DB > ENV) auf die laufenden Clients anwenden. */
function setQdrantRuntimeConfig({ url = '', apiKey = '' } = {}) {
  _runtime.url = String(url).replace(/\/+$/, '');
  _runtime.apiKey = apiKey || '';
}

class QdrantClient {
  constructor({ url, apiKey, http = null } = {}) {
    // Explizite Ctor-Werte (Tests) haben Vorrang; sonst live aus Runtime/ENV.
    this._ctorUrl = url ? String(url).replace(/\/+$/, '') : '';
    this._ctorKey = apiKey || '';
    this._http    = http || new RealHttpClient({ timeout: 15000, rejectUnauthorized: process.env.QDRANT_TLS_REJECT_UNAUTHORIZED === 'true' });
  }

  _baseUrl() {
    return this._ctorUrl
      || _runtime.url
      || (process.env.QDRANT_URL || '').replace(/\/+$/, '')
      || DEFAULT_URL;
  }

  _effKey() {
    return this._ctorKey || _runtime.apiKey || process.env.QDRANT_API_KEY || '';
  }

  _headers() {
    const key = this._effKey();
    return key ? { 'api-key': key } : {};
  }

  /** Verbindungstest: Collections listen. Fehler propagieren sichtbar. */
  async ping() {
    await this._http.request(`${this._baseUrl()}/collections`, { method: 'GET', headers: this._headers() });
    return { ok: true };
  }

  async ensureCollection(name, vectorSize, distance = 'Cosine') {
    try {
      await this._http.request(`${this._baseUrl()}/collections/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: this._headers(),
        body: { vectors: { size: vectorSize, distance } },
      });
    } catch (err) {
      // 409 = Collection existiert bereits — idempotent, ignorieren
      if (!String(err.message).includes('409')) throw err;
    }
  }

  async upsert(collection, points) {
    if (!points.length) return;
    await this._http.request(`${this._baseUrl()}/collections/${encodeURIComponent(collection)}/points`, {
      method: 'PUT',
      headers: this._headers(),
      body: { points },
    });
  }

  async search(collection, vector, topK = 3) {
    const res = await this._http.request(`${this._baseUrl()}/collections/${encodeURIComponent(collection)}/points/search`, {
      method: 'POST',
      headers: this._headers(),
      body: { vector, limit: topK, with_payload: true },
    });
    const result = (res.data && res.data.result) || [];
    return result.map((r) => ({ id: r.id, score: r.score, payload: r.payload || {} }));
  }
}

module.exports = { QdrantClient, setQdrantRuntimeConfig, DEFAULT_URL };
