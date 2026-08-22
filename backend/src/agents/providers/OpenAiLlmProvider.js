'use strict';

const { PromptAnalysisLlmProvider } = require('./OllamaLlmProvider');
const { RealHttpClient } = require('../../integrations/http/RealHttpClient');
const { CLOUD_SYSTEM_PROMPT, CLOUD_TIMEOUT_MS, requireApiKey, cloudLlmError } = require('./cloudLlmSupport');

const DEFAULT_MODEL = 'gpt-4o-mini';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * OpenAiLlmProvider — OpenAI Chat Completions API (response_format=json_object).
 * Erbt Prompt-/Parse-/Floor-Logik; nur _complete() ist OpenAI-spezifisch.
 * API-Key nur aus der Umgebung (OPENAI_API_KEY).
 *
 * ⚠ Cloud-Provider: Analyse-Prompt (inkl. Ticket-/Alert-Daten) verlässt das eigene Netz.
 */
class OpenAiLlmProvider extends PromptAnalysisLlmProvider {
  constructor({ apiKey, model, http, timeout, params = {} } = {}) {
    super({ http: http || new RealHttpClient({ timeout: timeout ?? CLOUD_TIMEOUT_MS }) });
    this._apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    this._model  = model  || process.env.OPENAI_MODEL   || DEFAULT_MODEL;
    const n = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
    this._temperature = n(params.temperature, 0.2);
    this._topP        = (params.topP != null && params.topP !== '') ? Number(params.topP) : null;
    this._maxTokens   = (params.maxTokens != null && params.maxTokens !== '') ? Number(params.maxTokens) : null;
    this.name    = `openai:${this._model}`;
  }

  async _complete(prompt) {
    requireApiKey(this._apiKey, 'OpenAI', 'OPENAI_API_KEY');
    let res;
    try {
      res = await this._http.request(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this._apiKey}` },
        body: {
          model:           this._model,
          temperature:     this._temperature,
          ...(this._topP != null      ? { top_p: this._topP } : {}),
          ...(this._maxTokens != null ? { max_tokens: this._maxTokens } : {}),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: CLOUD_SYSTEM_PROMPT },
            { role: 'user',   content: prompt },
          ],
        },
      });
    } catch (err) {
      throw cloudLlmError(err, 'OpenAI');
    }
    const text = res.data && res.data.choices && res.data.choices[0]
      && res.data.choices[0].message && res.data.choices[0].message.content;
    return String(text || '');
  }
}

module.exports = { OpenAiLlmProvider };
