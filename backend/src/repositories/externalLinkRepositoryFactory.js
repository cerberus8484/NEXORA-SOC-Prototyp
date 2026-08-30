'use strict';

// Wählt das ExternalLink-Repo: Postgres bei DB_ENABLED, sonst InMemory.
// Muster wie die anderen Domänen-Factories (dataplaneStatusRepositoryFactory).

const config = require('../config');
const logger = require('../logger');
const { InMemoryExternalLinkRepository } = require('./ExternalLinkRepository');

function createExternalLinkRepository() {
  if (config.db && config.db.enabled) {
    const { PostgresExternalLinkRepository } = require('./PostgresExternalLinkRepository');
    logger.info('external_link_repository_selected', { kind: 'postgres' });
    return new PostgresExternalLinkRepository();
  }
  logger.info('external_link_repository_selected', { kind: 'inmemory' });
  return new InMemoryExternalLinkRepository();
}

module.exports = { createExternalLinkRepository };
