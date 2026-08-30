'use strict';

// Wählt das Dataplane-Status-Repo: Postgres bei DB_ENABLED, sonst InMemory.
// Singleton, damit Ingress (POST /dataplane/status) und Read (GET /collectors/*)
// dieselbe Instanz teilen.

const config = require('../config');
const logger = require('../logger');
const { InMemoryDataplaneStatusRepository } = require('./InMemoryDataplaneStatusRepository');

let _singleton = null;

function createDataplaneStatusRepository() {
  if (config.db && config.db.enabled) {
    const { PostgresDataplaneStatusRepository } = require('./PostgresDataplaneStatusRepository');
    logger.info('dataplane_status_repository_selected', { kind: 'postgres' });
    return new PostgresDataplaneStatusRepository();
  }
  logger.info('dataplane_status_repository_selected', { kind: 'inmemory' });
  return new InMemoryDataplaneStatusRepository();
}

function getDataplaneStatusRepository() {
  if (!_singleton) _singleton = createDataplaneStatusRepository();
  return _singleton;
}

module.exports = { createDataplaneStatusRepository, getDataplaneStatusRepository };
