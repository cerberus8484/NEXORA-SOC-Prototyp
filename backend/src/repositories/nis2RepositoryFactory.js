'use strict';

/**
 * Factory: wählt InMemory oder Postgres je nach DB_ENABLED-Flag.
 * Konsistent zu den übrigen Repository-Factories.
 */

const config = require('../config');
const logger = require('../logger');
const { InMemoryNis2Repository } = require('./InMemoryNis2Repository');
const { PostgresNis2Repository } = require('./PostgresNis2Repository');

function createNis2Repository() {
  if (config.db.enabled) {
    logger.info('nis2_repository_selected', { impl: 'postgres' });
    return new PostgresNis2Repository();
  }
  logger.info('nis2_repository_selected', { impl: 'in-memory' });
  return new InMemoryNis2Repository();
}

module.exports = { createNis2Repository };
