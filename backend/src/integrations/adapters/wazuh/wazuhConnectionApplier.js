'use strict';

// Layer 2: die effektive Wazuh-Verbindung (DB > ENV) auf die laufenden
// Singleton-Clients anwenden — beim Boot (nach DB-Start) und nach jedem
// PUT /services/wazuh-connection. Kein Prozess-Neustart nötig.

const { createSettingsRepository } = require('../../../repositories/settingsRepositoryFactory');
const { resolveWazuhConnection }   = require('../../../services/wazuhConnectionSettings');
const { wazuhApiClient }           = require('./wazuhApiInstance');
const { wazuhIndexerClient }       = require('./wazuhIndexerInstance');
const logger                       = require('../../../logger');

async function applyWazuhConnection(repo = null) {
  const settingsRepo = repo || createSettingsRepository();
  const conn = await resolveWazuhConnection(settingsRepo);
  wazuhApiClient.reconfigure(conn.api);
  wazuhIndexerClient.reconfigure(conn.indexer);
  // Nur Quellen loggen — NIE URLs/User/Passwörter (Log-Hygiene).
  logger.info('wazuh_connection_applied', { apiSource: conn.api.source, indexerSource: conn.indexer.source });
  return conn;
}

module.exports = { applyWazuhConnection };
