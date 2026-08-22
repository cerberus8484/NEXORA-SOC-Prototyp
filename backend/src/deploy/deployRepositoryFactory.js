'use strict';

// Wählt das Deploy-Repo: Postgres bei DB_ENABLED, sonst InMemory.
// Gleicher öffentlicher Vertrag → Service/Orchestrator kennen nur das Interface.

const config = require('../config');
const logger = require('../logger');
const { InMemoryDeployRepository } = require('./InMemoryDeployRepository');

let _singleton = null;

function createDeployRepository() {
  if (config.db && config.db.enabled) {
    const { PostgresDeployRepository } = require('./PostgresDeployRepository');
    logger.info('deploy_repository_selected', { kind: 'postgres' });
    return new PostgresDeployRepository();
  }
  logger.info('deploy_repository_selected', { kind: 'inmemory' });
  return new InMemoryDeployRepository();
}

function getDeployRepository() {
  if (!_singleton) _singleton = createDeployRepository();
  return _singleton;
}

module.exports = { createDeployRepository, getDeployRepository };
