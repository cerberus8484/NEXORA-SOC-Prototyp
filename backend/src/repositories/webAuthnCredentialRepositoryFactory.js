'use strict';

const config = require('../config');

/**
 * Gibt die richtige WebAuthn-Credential-Repository-Implementierung zurück.
 * DB_ENABLED=true → Postgres, sonst InMemory (Tests/Dev).
 */
function createWebAuthnCredentialRepository() {
  if (config.db.enabled) {
    const { PostgresWebAuthnCredentialRepository } = require('./PostgresWebAuthnCredentialRepository');
    return new PostgresWebAuthnCredentialRepository();
  }
  const { InMemoryWebAuthnCredentialRepository } = require('./InMemoryWebAuthnCredentialRepository');
  return new InMemoryWebAuthnCredentialRepository();
}

module.exports = { createWebAuthnCredentialRepository };
