'use strict';

const { SettingsRepository } = require('./SettingsRepository');

// Schlüssel mit ihren ENV-Fallback-Defaults.
const DEFAULTS = {
  ollamaBaseUrl:    () => process.env.OLLAMA_BASE_URL    ?? '',
  ollamaModel:      () => process.env.OLLAMA_MODEL       ?? '',
  agentLlmProvider: () => process.env.AGENT_LLM_PROVIDER ?? 'stub',
  ragEnabled:       () => process.env.RAG_ENABLED === 'true',
  // Cloud-Modelle (leer = Provider-Default).
  anthropicModel:   () => process.env.ANTHROPIC_MODEL    ?? '',
  openaiModel:      () => process.env.OPENAI_MODEL       ?? '',
  googleModel:      () => process.env.GOOGLE_AI_MODEL    ?? '',
  // Fallback-Kette + globale Modell-Parameter (leer = Provider-Default).
  agentFallback1:   () => '',
  agentFallback2:   () => '',
  llmTemperature:   () => '',
  llmTopP:          () => '',
  llmMaxTokens:     () => '',
};

/**
 * InMemorySettingsRepository — Tests + Dev ohne DB.
 * Lädt ENV-Defaults beim ersten Zugriff; überschreiben via set().
 */
class InMemorySettingsRepository extends SettingsRepository {
  constructor() {
    super();
    this._store = new Map();
    for (const [key, defaultFn] of Object.entries(DEFAULTS)) {
      this._store.set(key, defaultFn());
    }
  }

  async get(key) {
    return this._store.has(key) ? this._store.get(key) : null;
  }

  async set(key, value) {
    this._store.set(key, value);
  }

  async getAll() {
    return Object.fromEntries(this._store.entries());
  }

  // Test-Hilfsmethode
  clear() { this._store.clear(); }
}

module.exports = { InMemorySettingsRepository };
