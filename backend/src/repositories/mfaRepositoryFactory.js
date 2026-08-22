'use strict';

const config = require('../config');

/**
 * Gibt die richtige MFA-Repository-Implementierung zurück.
 * DB_ENABLED=true → Postgres, sonst InMemory (Tests/Dev).
 */
function createMfaRepository() {
  if (config.db.enabled) {
    const { PostgresMfaRepository } = require('./PostgresMfaRepository');
    return new PostgresMfaRepository();
  }
  const { InMemoryMfaRepository } = require('./InMemoryMfaRepository');
  return new InMemoryMfaRepository();
}

module.exports = { createMfaRepository };
