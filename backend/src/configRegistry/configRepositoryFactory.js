'use strict';

// P_CONFIG_1 — wählt das Config-Repository: Postgres bei DB_ENABLED, sonst InMemory.
// Gleicher öffentlicher Vertrag → Business-Logik kennt nur das Interface.

const config = require('../config');
const logger = require('../logger');
const { InMemoryConfigRepository } = require('./InMemoryConfigRepository');

let _singleton = null;

function createConfigRepository() {
  if (config.db && config.db.enabled) {
    const { pool } = require('../db/pool');
    const { PostgresConfigRepository } = require('./PostgresConfigRepository');
    logger.info('config_repository_selected', { kind: 'postgres' });
    return new PostgresConfigRepository({ queryFn: (sql, params) => pool.query(sql, params) });
  }
  logger.info('config_repository_selected', { kind: 'inmemory' });
  return new InMemoryConfigRepository();
}

function getConfigRepository() {
  if (!_singleton) _singleton = createConfigRepository();
  return _singleton;
}

module.exports = { createConfigRepository, getConfigRepository };
