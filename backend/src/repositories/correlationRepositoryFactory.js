'use strict';

/**
 * Factory: wählt InMemory oder Postgres je nach DB_ENABLED-Flag.
 * Konsistent zu den übrigen Repository-Factories.
 */

const config = require('../config');
const logger = require('../logger');
const { InMemoryCorrelationRepository } = require('./InMemoryCorrelationRepository');
const { PostgresCorrelationRepository } = require('./PostgresCorrelationRepository');

function createCorrelationRepository() {
  if (config.db.enabled) {
    logger.info('correlation_repository_selected', { impl: 'postgres' });
    return new PostgresCorrelationRepository();
  }
  logger.info('correlation_repository_selected', { impl: 'in-memory' });
  return new InMemoryCorrelationRepository();
}

module.exports = { createCorrelationRepository };
