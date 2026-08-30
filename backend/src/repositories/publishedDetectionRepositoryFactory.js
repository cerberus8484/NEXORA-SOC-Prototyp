'use strict';

const config  = require('../config');
const logger  = require('../logger');
const { InMemoryPublishedDetectionRepository } = require('./InMemoryPublishedDetectionRepository');
const { PostgresPublishedDetectionRepository } = require('./PostgresPublishedDetectionRepository');

/**
 * Wählt die PublishedDetection-Repository-Implementierung anhand der Konfiguration.
 * DB_ENABLED=true → Postgres (restart-fest), sonst InMemory (Tests/Dev).
 */
function createPublishedDetectionRepository() {
  if (config.db.enabled) {
    logger.info('published_detection_repository_selected', { impl: 'postgres' });
    return new PostgresPublishedDetectionRepository();
  }
  logger.info('published_detection_repository_selected', { impl: 'in-memory' });
  return new InMemoryPublishedDetectionRepository();
}

module.exports = { createPublishedDetectionRepository };
