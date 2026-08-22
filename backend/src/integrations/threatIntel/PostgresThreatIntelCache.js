'use strict';

// PostgresThreatIntelCache — persistenter TI-Cache (überlebt Neustart).
// Gleicher Vertrag wie InMemoryThreatIntelCache: get(key)→value|null (TTL-geprüft),
// set(key, value, ttlMs). Tabelle wird lazy angelegt (wie PostgresSettingsRepository).
const { ThreatIntelCacheRepository } = require('./ThreatIntelCacheRepository');
const { query } = require('../../db/pool');
const logger = require('../../logger');

class PostgresThreatIntelCache extends ThreatIntelCacheRepository {
  async _ensureTable() {
    await query(`
      CREATE TABLE IF NOT EXISTS threat_intel_cache (
        key        TEXT PRIMARY KEY,
        value      JSONB        NOT NULL,
        expires_at TIMESTAMPTZ  NOT NULL
      )
    `);
  }

  async get(key) {
    await this._ensureTable();
    const res = await query('SELECT value, expires_at FROM threat_intel_cache WHERE key = $1', [key]);
    if (res.rows.length === 0) return null;
    // Abgelaufen → null (und best-effort aufräumen). Fehler beim Löschen blockiert
    // den Cache-Miss nicht, wird aber sichtbar geloggt statt still geschluckt.
    if (new Date(res.rows[0].expires_at).getTime() <= Date.now()) {
      await query('DELETE FROM threat_intel_cache WHERE key = $1', [key])
        .catch((err) => logger.warn('threat_intel_cache_cleanup_failed', { message: err.message }));
      return null;
    }
    return res.rows[0].value;
  }

  async set(key, value, ttlMs) {
    await this._ensureTable();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await query(`
      INSERT INTO threat_intel_cache (key, value, expires_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (key) DO UPDATE SET
        value      = EXCLUDED.value,
        expires_at = EXCLUDED.expires_at
    `, [key, JSON.stringify(value), expiresAt]);
  }
}

module.exports = { PostgresThreatIntelCache };
