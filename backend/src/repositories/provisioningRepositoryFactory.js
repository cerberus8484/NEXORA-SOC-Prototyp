'use strict';

/**
 * Factory: wählt InMemory oder Postgres je nach DB_ENABLED-Flag.
 * Konsistent zu autonomyPolicyRepositoryFactory.js und anderen Factory-Dateien.
 */

const config = require('../config');
const logger = require('../logger');
const { InMemoryProvisioningRepository } = require('./InMemoryProvisioningRepository');
const { PostgresProvisioningRepository } = require('./PostgresProvisioningRepository');

function createProvisioningRepository() {
  if (config.db.enabled) {
    logger.info('provisioning_repository_selected', { impl: 'postgres' });
    return new PostgresProvisioningRepository();
  }
  logger.info('provisioning_repository_selected', { impl: 'in-memory' });
  return new InMemoryProvisioningRepository();
}

module.exports = { createProvisioningRepository };
