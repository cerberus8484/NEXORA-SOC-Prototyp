'use strict';

// Layer 2: die effektive QRadar-Verbindung (DB > ENV) auf die Singleton-Provider-
// Instanz anwenden — beim Boot (nach DB-Start) und nach jedem PUT. Kein Neustart.

const { createSettingsRepository } = require('../../../repositories/settingsRepositoryFactory');
const { resolveQradarConnection }  = require('../../../services/qradarConnectionSettings');
const { qradarDashboardProvider }  = require('./QRadarDashboardProvider');
const logger                       = require('../../../logger');

async function applyQradarConnection(repo = null) {
  const settingsRepo = repo || createSettingsRepository();
  const conn = await resolveQradarConnection(settingsRepo);
  qradarDashboardProvider.reconfigure({ baseUrl: conn.baseUrl, token: conn.token });
  // Nur die Quelle loggen — NIE URL/Token.
  logger.info('qradar_connection_applied', { source: conn.source });
  return conn;
}

module.exports = { applyQradarConnection };
