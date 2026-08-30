'use strict';

const logger = require('../../logger');
const { LlmProvider }        = require('./LlmProvider');
const { StubLlmProvider }    = require('./StubLlmProvider');
const { OllamaLlmProvider }  = require('./OllamaLlmProvider');
const { AnthropicLlmProvider } = require('./AnthropicLlmProvider');
const { OpenAiLlmProvider }    = require('./OpenAiLlmProvider');
const { GoogleAiLlmProvider }  = require('./GoogleAiLlmProvider');
const { createSettingsRepository } = require('../../repositories/settingsRepositoryFactory');
const { decryptSecret } = require('../../config/secretsCrypto');

// Bekannte Provider-Kinds (für Settings-Validierung + Status).
const PROVIDER_KINDS = ['stub', 'ollama', 'anthropic', 'openai', 'google'];

// Settings-Key mit dem aktiven Modell je Provider.
const MODEL_SETTING_KEY = {
  ollama: 'ollamaModel', anthropic: 'anthropicModel', openai: 'openaiModel', google: 'googleModel',
};

// Settings-Key mit dem (verschlüsselten) API-Key je Cloud-Provider.
const KEY_SETTING_KEY = {
  anthropic: 'anthropicApiKey', openai: 'openaiApiKey', google: 'googleApiKey',
};

// ENV-Variable mit dem API-Key je Cloud-Provider (Vorrang vor DB).
const API_KEY_ENV = {
  anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_AI_API_KEY',
};

const lower = (v) => String(v || '').toLowerCase();

/** Baut einen konkreten Provider mit Modell, API-Key und Modell-Parametern. */
// `timeout` (ms) + `baseUrl` sind optional. Der Verbindungstest gibt ein KURZES Timeout
// vor, damit ein voller Inference-Lauf (Ollama-Default 120s) nicht hinter nginx
// (proxy_read_timeout 60s) ein 504 auslöst. Ungenutzte Opts ignorieren die Provider.
function buildProvider(kind, { model, apiKey, params, timeout, baseUrl } = {}) {
  switch (lower(kind)) {
    case 'ollama':
      return new OllamaLlmProvider({ baseUrl: baseUrl || process.env.OLLAMA_BASE_URL, model: model || process.env.OLLAMA_MODEL, params, timeout });
    case 'anthropic':
      return new AnthropicLlmProvider({ apiKey, model, params, timeout });
    case 'openai':
      return new OpenAiLlmProvider({ apiKey, model, params, timeout });
    case 'google':
      return new GoogleAiLlmProvider({ apiKey, model, params, timeout });
    default:
      return new StubLlmProvider();
  }
}

/** Boot-/Test-Auswahl rein aus der Umgebung (AGENT_LLM_PROVIDER) — inkl. Log. */
function createLlmProvider() {
  const kind = lower(process.env.AGENT_LLM_PROVIDER || 'stub');
  const provider = buildProvider(kind, {});
  logger.info('llm_provider_selected', { impl: provider.name || 'stub-llm-v1' });
  return provider;
}

/** Löst den API-Key eines Providers auf: ENV hat Vorrang, sonst entschlüsselter DB-Wert. */
async function resolveApiKey(kind, repo) {
  const env = API_KEY_ENV[kind];
  if (!env) return null;
  if (process.env[env]) return process.env[env];
  const stored = await repo.get(KEY_SETTING_KEY[kind]);
  return stored ? decryptSecret(stored) : '';
}

/**
 * Liest die komplette Agent-LLM-Konfiguration aus den Settings (UI), ENV-Fallback:
 * Primär-Provider + Fallback-Kette, je mit Modell + API-Key, plus globale Modell-Parameter.
 * @returns {Promise<{ chain: Array<{ kind, model, apiKey, params }> , params }>}
 */
async function loadAgentLlmConfig() {
  try {
    const repo = createSettingsRepository();
    const primary = lower((await repo.get('agentLlmProvider')) || process.env.AGENT_LLM_PROVIDER || 'stub');
    const fb1 = lower(await repo.get('agentFallback1'));
    const fb2 = lower(await repo.get('agentFallback2'));

    const num = (v) => {
      if (v === '' || v === null || v === undefined) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const params = {
      temperature: num(await repo.get('llmTemperature')),
      topP:        await repo.get('llmTopP'),
      maxTokens:   num(await repo.get('llmMaxTokens')),
    };

    const kinds = [primary, fb1, fb2].filter((k, i, a) => k && PROVIDER_KINDS.includes(k) && a.indexOf(k) === i);
    const chain = [];
    for (const kind of (kinds.length ? kinds : ['stub'])) {
      chain.push({
        kind,
        model:  MODEL_SETTING_KEY[kind] ? (await repo.get(MODEL_SETTING_KEY[kind]) || null) : null,
        apiKey: await resolveApiKey(kind, repo),
        baseUrl: kind === 'ollama' ? (await repo.get('ollamaBaseUrl') || null) : null,
        params,
      });
    }
    return { chain, params };
  } catch {
    return { chain: [{ kind: lower(process.env.AGENT_LLM_PROVIDER || 'stub'), params: {} }], params: {} };
  }
}

/** Sync ENV-only-Verfügbarkeit (für Tests/Boot). */
function providerAvailability() {
  return PROVIDER_KINDS.map((kind) => {
    const env = API_KEY_ENV[kind];
    const requiresKey = Boolean(env);
    return { provider: kind, requiresKey, configured: requiresKey ? Boolean(process.env[env]) : true, keyEnvVar: env || null };
  });
}

/** Async-Verfügbarkeit inkl. im Backend gespeicherter (verschlüsselter) Keys. */
async function providerStatus() {
  const repo = createSettingsRepository();
  const out = [];
  for (const kind of PROVIDER_KINDS) {
    const env = API_KEY_ENV[kind];
    const requiresKey = Boolean(env);
    let configured = !requiresKey;
    let keySource = null;
    if (requiresKey) {
      if (process.env[env]) { configured = true; keySource = 'env'; }
      else if (await repo.get(KEY_SETTING_KEY[kind])) { configured = true; keySource = 'backend'; }
    }
    out.push({ provider: kind, requiresKey, configured, keyEnvVar: env || null, keySource });
  }
  return out;
}

function isProviderUnavailable(err) {
  if (!err) return false;
  if (typeof err.code === 'string' && err.code.startsWith('AGENT_LLM')) return true;
  return err.status === 503;
}

// Cached gemeinsame Provider-Instanzen über die dynamischen Wrapper hinweg.
const _instanceCache = new Map();
function _getInstance(cfg) {
  const key = `${cfg.kind}::${cfg.model || ''}::${cfg.baseUrl || ''}::${cfg.apiKey ? 'k' : '0'}::${JSON.stringify(cfg.params || {})}`;
  let inst = _instanceCache.get(key);
  if (!inst) { inst = buildProvider(cfg.kind, cfg); _instanceCache.set(key, inst); }
  return inst;
}

/**
 * DynamicLlmProvider — wählt EINEN Provider zur Laufzeit aus den Settings (ENV-Fallback).
 */
class DynamicLlmProvider extends LlmProvider {
  constructor() { super(); this.name = 'dynamic-llm'; }
  async propose(args) {
    const { chain } = await loadAgentLlmConfig();
    return _getInstance(chain[0]).propose(args);
  }
}

/**
 * FallbackLlmProvider — versucht Primär-Provider, weicht bei Ausfall/Timeout/Auth-Fehler
 * automatisch auf die Fallback-Kette aus. Nicht-Provider-Fehler werden durchgereicht.
 */
class FallbackLlmProvider extends LlmProvider {
  constructor() { super(); this.name = 'fallback-llm'; }
  async propose(args) {
    const { chain } = await loadAgentLlmConfig();
    let lastErr;
    for (const cfg of chain) {
      try {
        return await _getInstance(cfg).propose(args);
      } catch (err) {
        lastErr = err;
        if (!isProviderUnavailable(err)) throw err;
        logger.warn('llm_provider_fallback', { from: cfg.kind, reason: err.code || err.message });
      }
    }
    throw lastErr || new Error('Kein LLM-Provider verfügbar');
  }
}

module.exports = {
  createLlmProvider,
  buildProvider,
  loadAgentLlmConfig,
  resolveApiKey,
  providerAvailability,
  providerStatus,
  DynamicLlmProvider,
  FallbackLlmProvider,
  PROVIDER_KINDS,
  MODEL_SETTING_KEY,
  KEY_SETTING_KEY,
};
