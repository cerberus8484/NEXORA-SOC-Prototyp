'use strict';

const { RealHttpClient } = require('../integrations/http/RealHttpClient');

class OllamaEmbedder {
  constructor({ baseUrl, model, http = null, timeout } = {}) {
    const t = timeout ?? parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10);
    this._baseUrl = (baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    this._model   = model || process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
    // TLS-Validierung per ENV konfigurierbar (Default false: interner Service, oft http/self-signed).
    this._http    = http || new RealHttpClient({ timeout: t, rejectUnauthorized: process.env.OLLAMA_TLS_REJECT_UNAUTHORIZED === 'true' });
  }

  get model() { return this._model; }

  async embed(text) {
    const [vec] = await this.embedBatch([String(text ?? '')]);
    return vec;
  }

  async embedBatch(texts) {
    const input = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? ''));
    const res = await this._http.request(`${this._baseUrl}/api/embed`, {
      method: 'POST',
      body: { model: this._model, input },
    });
    const embeddings = res.data && res.data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== input.length) {
      throw Object.assign(new Error('Ollama-Embedding-Antwort ungültig'), { status: 502 });
    }
    return embeddings;
  }
}

module.exports = { OllamaEmbedder };
