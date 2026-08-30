'use strict';

// Wählt das ManualHost-Repo: Postgres bei DB_ENABLED, sonst InMemory.
// Muster wie die anderen Domänen-Factories (externalLinkRepositoryFactory).

const config = require('../config');
const logger = require('../logger');
const { InMemoryManualHostRepository } = require('./ManualHostRepository');

function createManualHostRepository() {
  if (config.db && config.db.enabled) {
    const { PostgresManualHostRepository } = require('./PostgresManualHostRepository');
    logger.info('manual_host_repository_selected', { kind: 'postgres' });
    return new PostgresManualHostRepository();
  }
  logger.info('manual_host_repository_selected', { kind: 'inmemory' });
  return new InMemoryManualHostRepository();
}

module.exports = { createManualHostRepository };
