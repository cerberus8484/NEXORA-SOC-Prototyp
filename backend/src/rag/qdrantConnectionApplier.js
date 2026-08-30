'use strict';

// Layer 2: die effektive Qdrant-Verbindung (DB > ENV) auf die modulweite
// Runtime-Config anwenden — beim Boot (nach DB-Start) und nach jedem PUT.
// Alle QdrantClient-Instanzen lesen diese Config live (kein Neustart).

const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { resolveQdrantConnection }  = require('../services/qdrantConnectionSettings');
const { setQdrantRuntimeConfig }   = require('./QdrantClient');
const logger                       = require('../logger');

async function applyQdrantConnection(repo = null) {
  const settingsRepo = repo || createSettingsRepository();
  const conn = await resolveQdrantConnection(settingsRepo);
  setQdrantRuntimeConfig({ url: conn.url, apiKey: conn.apiKey });
  // Nur die Quelle loggen — NIE URL/Key.
  logger.info('qdrant_connection_applied', { source: conn.source });
  return conn;
}

module.exports = { applyQdrantConnection };
