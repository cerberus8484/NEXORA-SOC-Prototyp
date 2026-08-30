'use strict';

// P_CORR_ADMIN_2 Stufe 3 — wählt das Worker-Status-Repo: Postgres bei DB_ENABLED, sonst InMemory.

const config = require('../config');
const logger = require('../logger');
const { InMemoryWorkerStatusRepository } = require('./InMemoryWorkerStatusRepository');

let _singleton = null;

function createWorkerStatusRepository() {
  if (config.db && config.db.enabled) {
    const { PostgresWorkerStatusRepository } = require('./PostgresWorkerStatusRepository');
    logger.info('worker_status_repository_selected', { kind: 'postgres' });
    return new PostgresWorkerStatusRepository();
  }
  logger.info('worker_status_repository_selected', { kind: 'inmemory' });
  return new InMemoryWorkerStatusRepository();
}

function getWorkerStatusRepository() {
  if (!_singleton) _singleton = createWorkerStatusRepository();
  return _singleton;
}

module.exports = { createWorkerStatusRepository, getWorkerStatusRepository };
