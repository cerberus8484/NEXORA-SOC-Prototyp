'use strict';

const config                     = require('../config');
const logger                     = require('../logger');
const { InMemoryUserRepository } = require('./InMemoryUserRepository');
const { PostgresUserRepository } = require('./PostgresUserRepository');

function createUserRepository() {
  if (config.db.enabled) {
    logger.info('user_repository_selected', { impl: 'postgres' });
    return new PostgresUserRepository();
  }
  logger.info('user_repository_selected', { impl: 'in-memory' });
  return new InMemoryUserRepository();
}

module.exports = { createUserRepository };
