'use strict';

const { PromptAnalysisLlmProvider } = require('./OllamaLlmProvider');
const { RealHttpClient } = require('../../integrations/http/RealHttpClient');
const { CLOUD_SYSTEM_PROMPT, CLOUD_TIMEOUT_MS, requireApiKey, cloudLlmError } = require('./cloudLlmSupport');

const DEFAULT_MODEL = 'gemini-2.0-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * GoogleAiLlmProvider — Google Gemini generateContent API (responseMimeType=application/json).
 * Erbt Prompt-/Parse-/Floor-Logik; nur _complete() ist Gemini-spezifisch.
 * API-Key nur aus der Umgebung (GOOGLE_AI_API_KEY), via x-goog-api-key-Header
 * (NICHT als URL-Query — der Key landet so nie in URLs/Logs).
 *
 * ⚠ Cloud-Provider: Analyse-Prompt (inkl. Ticket-/Alert-Daten) verlässt das eigene Netz.
 */
class GoogleAiLlmProvider extends PromptAnalysisLlmProvider {
  constructor({ apiKey, model, http, timeout, params = {} } = {}) {
    super({ http: http || new RealHttpClient({ timeout: timeout ?? CLOUD_TIMEOUT_MS }) });
    this._apiKey = apiKey || process.env.GOOGLE_AI_API_KEY || '';
    this._model  = model  || process.env.GOOGLE_AI_MODEL   || DEFAULT_MODEL;
    const n = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
    this._temperature = n(params.temperature, 0.2);
    this._topP        = (params.topP != null && params.topP !== '') ? Number(params.topP) : null;
    this._maxTokens   = (params.maxTokens != null && params.maxTokens !== '') ? Number(params.maxTokens) : null;
    this.name    = `google:${this._model}`;
  }

  async _complete(prompt) {
    requireApiKey(this._apiKey, 'Google AI', 'GOOGLE_AI_API_KEY');
    let res;
    try {
      res = await this._http.request(`${BASE}/${encodeURIComponent(this._model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this._apiKey },
        body: {
          systemInstruction: { parts: [{ text: CLOUD_SYSTEM_PROMPT }] },
          contents:          [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig:  {
            temperature: this._temperature,
            ...(this._topP != null      ? { topP: this._topP } : {}),
            ...(this._maxTokens != null ? { maxOutputTokens: this._maxTokens } : {}),
            responseMimeType: 'application/json',
          },
        },
      });
    } catch (err) {
      throw cloudLlmError(err, 'Google AI');
    }
    const cand  = res.data && res.data.candidates && res.data.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    const text  = Array.isArray(parts) ? parts.map((p) => p && p.text).filter(Boolean).join('') : '';
    return String(text || '');
  }
}

module.exports = { GoogleAiLlmProvider };
