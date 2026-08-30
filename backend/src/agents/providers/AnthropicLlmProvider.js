'use strict';

const { PromptAnalysisLlmProvider } = require('./OllamaLlmProvider');
const { RealHttpClient } = require('../../integrations/http/RealHttpClient');
const { CLOUD_SYSTEM_PROMPT, CLOUD_TIMEOUT_MS, requireApiKey, cloudLlmError } = require('./cloudLlmSupport');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/**
 * AnthropicLlmProvider — Claude Messages API.
 * Erbt die gesamte Prompt-/Parse-/Evidence-Floor-Logik; nur _complete() ist
 * Anthropic-spezifisch. API-Key ausschließlich aus der Umgebung (ANTHROPIC_API_KEY),
 * nie im Code/Log/DB.
 *
 * ⚠ Cloud-Provider: der Analyse-Prompt (inkl. Ticket-/Alert-Daten) verlässt das
 * eigene Netz. Bewusst opt-in (AGENT_LLM_PROVIDER=anthropic bzw. Settings).
 */
class AnthropicLlmProvider extends PromptAnalysisLlmProvider {
  constructor({ apiKey, model, http, timeout, params = {} } = {}) {
    super({ http: http || new RealHttpClient({ timeout: timeout ?? CLOUD_TIMEOUT_MS }) });
    this._apiKey      = apiKey || process.env.ANTHROPIC_API_KEY || '';
    this._model       = model  || process.env.ANTHROPIC_MODEL   || DEFAULT_MODEL;
    const n = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
    this._maxTokens   = n(params.maxTokens, parseInt(process.env.ANTHROPIC_MAX_TOKENS || '6000', 10));
    this._temperature = n(params.temperature, 0.2);
    this._topP        = (params.topP != null && params.topP !== '') ? Number(params.topP) : null;
    this.name         = `anthropic:${this._model}`;
  }

  async _complete(prompt) {
    requireApiKey(this._apiKey, 'Anthropic', 'ANTHROPIC_API_KEY');
    let res;
    try {
      // Claude Opus 4.7+ lehnt Sampling-Parameter in der Messages API ab.
      // Anthropic-seitig steuern wir Determinismus daher per Prompt statt per temperature/top_p.
      res = await this._http.request(ENDPOINT, {
        method: 'POST',
        headers: { 'x-api-key': this._apiKey, 'anthropic-version': '2023-06-01' },
        body: {
          model:      this._model,
          max_tokens: this._maxTokens,
          system:     CLOUD_SYSTEM_PROMPT,
          messages:   [{ role: 'user', content: prompt }],
        },
      });
    } catch (err) {
      throw cloudLlmError(err, 'Anthropic');
    }
    const blocks = res.data && res.data.content;
    const text = Array.isArray(blocks)
      ? blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('')
      : '';
    return String(text || '');
  }
}

module.exports = { AnthropicLlmProvider };
