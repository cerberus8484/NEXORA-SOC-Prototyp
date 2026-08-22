'use strict';

const { SettingsRepository } = require('./SettingsRepository');
const { query }              = require('../db/pool');

// ENV-Defaults — identisch mit InMemory, damit der erste DB-Zugriff vollständig ist.
const DEFAULTS = {
  ollamaBaseUrl:    process.env.OLLAMA_BASE_URL    ?? '',
  ollamaModel:      process.env.OLLAMA_MODEL       ?? '',
  agentLlmProvider: process.env.AGENT_LLM_PROVIDER ?? 'stub',
  ragEnabled:       process.env.RAG_ENABLED === 'true',
  anthropicModel:   process.env.ANTHROPIC_MODEL    ?? '',
  openaiModel:      process.env.OPENAI_MODEL       ?? '',
  googleModel:      process.env.GOOGLE_AI_MODEL    ?? '',
  agentFallback1:   '',
  agentFallback2:   '',
  llmTemperature:   '',
  llmTopP:          '',
  llmMaxTokens:     '',
};

/**
 * PostgresSettingsRepository — persistente Plattform-Einstellungen.
 * Tabelle wird beim ersten Zugriff angelegt (CREATE TABLE IF NOT EXISTS).
 */
class PostgresSettingsRepository extends SettingsRepository {
  async _ensureTable() {
    await query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key        TEXT PRIMARY KEY,
        value      JSONB        NOT NULL,
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
  }

  async get(key) {
    await this._ensureTable();
    const res = await query('SELECT value FROM platform_settings WHERE key = $1', [key]);
    if (res.rows.length === 0) return DEFAULTS[key] ?? null;
    return res.rows[0].value;
  }

  async set(key, value) {
    await this._ensureTable();
    await query(`
      INSERT INTO platform_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value      = EXCLUDED.value,
        updated_at = NOW()
    `, [key, JSON.stringify(value)]);
  }

  async getAll() {
    await this._ensureTable();
    const res = await query('SELECT key, value FROM platform_settings');
    return { ...DEFAULTS, ...Object.fromEntries(res.rows.map((r) => [r.key, r.value])) };
  }
}

module.exports = { PostgresSettingsRepository };
