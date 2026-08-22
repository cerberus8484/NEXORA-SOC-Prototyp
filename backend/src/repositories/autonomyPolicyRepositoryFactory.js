'use strict';

/**
 * Factory: wählt InMemory oder Postgres je nach DB_ENABLED-Flag.
 * Konsistent zu ticketRepositoryFactory.js und anderen Factory-Dateien.
 */

const config = require('../config');
const logger = require('../logger');
const { InMemoryAutonomyPolicyRepository } = require('./InMemoryAutonomyPolicyRepository');
const { PostgresAutonomyPolicyRepository } = require('./PostgresAutonomyPolicyRepository');

function createAutonomyPolicyRepository() {
  if (config.db.enabled) {
    logger.info('autonomy_policy_repository_selected', { impl: 'postgres' });
    return new PostgresAutonomyPolicyRepository();
  }
  logger.info('autonomy_policy_repository_selected', { impl: 'in-memory' });
  return new InMemoryAutonomyPolicyRepository();
}

module.exports = { createAutonomyPolicyRepository };
