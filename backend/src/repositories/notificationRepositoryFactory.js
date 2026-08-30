'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryNotificationRepository } = require('./InMemoryNotificationRepository');
const { PostgresNotificationRepository } = require('./PostgresNotificationRepository');

/**
 * Factory — wählt Postgres (DB_ENABLED=true) oder InMemory (Dev/Tests).
 * Identisches Muster wie ticketRepositoryFactory.js.
 */
function createNotificationRepository() {
  if (config.db.enabled) {
    logger.info('notification_repository_selected', { impl: 'postgres' });
    return new PostgresNotificationRepository();
  }
  logger.info('notification_repository_selected', { impl: 'in-memory' });
  return new InMemoryNotificationRepository();
}

module.exports = { createNotificationRepository };
