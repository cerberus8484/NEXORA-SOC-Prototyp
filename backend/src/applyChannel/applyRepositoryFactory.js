'use strict';

// P_CORR_ADMIN_2 Stufe 2 — wählt das Apply-Repo: Postgres bei DB_ENABLED, sonst InMemory.
// Gleicher öffentlicher Vertrag → Apply-Executor kennt nur das Interface.

const config = require('../config');
const logger = require('../logger');
const { InMemoryApplyRepository } = require('./InMemoryApplyRepository');

let _singleton = null;

function createApplyRepository() {
  if (config.db && config.db.enabled) {
    const { PostgresApplyRepository } = require('./PostgresApplyRepository');
    logger.info('apply_repository_selected', { kind: 'postgres' });
    return new PostgresApplyRepository();
  }
  logger.info('apply_repository_selected', { kind: 'inmemory' });
  return new InMemoryApplyRepository();
}

function getApplyRepository() {
  if (!_singleton) _singleton = createApplyRepository();
  return _singleton;
}

module.exports = { createApplyRepository, getApplyRepository };
