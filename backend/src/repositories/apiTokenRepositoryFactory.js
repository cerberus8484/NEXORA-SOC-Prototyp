'use strict';

const config = require('../config');

/**
 * Gibt die richtige Repository-Implementierung zurück.
 * DB_ENABLED=true → Postgres, sonst InMemory (Tests/Dev).
 */
function createApiTokenRepository() {
  if (config.db.enabled) {
    const { PostgresApiTokenRepository } = require('./PostgresApiTokenRepository');
    return new PostgresApiTokenRepository();
  }
  const { InMemoryApiTokenRepository } = require('./InMemoryApiTokenRepository');
  return new InMemoryApiTokenRepository();
}

module.exports = { createApiTokenRepository };
