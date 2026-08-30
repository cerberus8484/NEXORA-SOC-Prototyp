'use strict';

const { RealHttpClient } = require('../integrations/http/RealHttpClient');
const { isAllowedOllamaUrl } = require('../integrations/http/ollamaUrlAllowlist');

/**
 * Prüft die Erreichbarkeit der Ollama-API über /api/tags.
 * Optional kann zusätzlich validiert werden, dass ein bestimmtes Modell geladen ist.
 *
 * @param {{
 *   baseUrl?: string,
 *   model?: string | null,
 *   requireModel?: boolean,
 *   timeout?: number,
 *   httpClient?: { request: (url: string, init?: object) => Promise<{ data?: any }> },
 * }} opts
 * @returns {Promise<{ reachable: boolean, modelAvailable: boolean | null, reason: string, message: string, models: string[] }>}
 */
async function probeOllamaConnection({
  baseUrl,
  model = null,
  requireModel = false,
  timeout = 5000,
  httpClient = null,
} = {}) {
  const trimmedBaseUrl = String(baseUrl || '').trim();
  const wantedModel = String(model || '').trim();

  if (!trimmedBaseUrl) {
    return {
      reachable: false,
      modelAvailable: null,
      reason: 'not_configured',
      message: 'Ollama nicht konfiguriert (ollamaBaseUrl fehlt)',
      models: [],
    };
  }

  if (!isAllowedOllamaUrl(trimmedBaseUrl)) {
    return {
      reachable: false,
      modelAvailable: null,
      reason: 'invalid_url',
      message: 'ollamaBaseUrl muss auf einen internen Host zeigen (localhost, RFC-1918)',
      models: [],
    };
  }

  const http = httpClient || new RealHttpClient({ timeout });
  const tagsUrl = `${trimmedBaseUrl.replace(/\/+$/, '')}/api/tags`;

  let response;
  try {
    response = await http.request(tagsUrl, { method: 'GET' });
  } catch {
    return {
      reachable: false,
      modelAvailable: null,
      reason: 'unreachable',
      message: 'Ollama ist nicht erreichbar',
      models: [],
    };
  }

  const rawModels = Array.isArray(response?.data?.models) ? response.data.models : null;
  if (!rawModels) {
    return {
      reachable: false,
      modelAvailable: null,
      reason: 'invalid_response',
      message: 'Ollama antwortet ungueltig',
      models: [],
    };
  }

  const modelNames = rawModels
    .map((entry) => String(entry?.name || '').trim())
    .filter(Boolean);

  const modelAvailable = wantedModel ? modelNames.includes(wantedModel) : null;
  if (requireModel && wantedModel && modelAvailable === false) {
    return {
      reachable: true,
      modelAvailable: false,
      reason: 'model_missing',
      message: `Ollama erreichbar, aber Modell '${wantedModel}' ist nicht geladen`,
      models: modelNames,
    };
  }

  if (wantedModel && modelAvailable === false) {
    return {
      reachable: true,
      modelAvailable: false,
      reason: 'model_missing',
      message: `Ollama erreichbar; Modell '${wantedModel}' ist nicht geladen`,
      models: modelNames,
    };
  }

  return {
    reachable: true,
    modelAvailable,
    reason: 'ok',
    message: 'Ollama erreichbar',
    models: modelNames,
  };
}

module.exports = { probeOllamaConnection };
