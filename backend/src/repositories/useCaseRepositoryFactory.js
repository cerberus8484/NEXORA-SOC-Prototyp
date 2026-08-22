'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryUseCaseRepository } = require('./InMemoryUseCaseRepository');
const { PostgresUseCaseRepository } = require('./PostgresUseCaseRepository');

function createUseCaseRepository() {
  if (config.db.enabled) {
    logger.info('use_case_repository_selected', { impl: 'postgres' });
    return new PostgresUseCaseRepository();
  }
  logger.info('use_case_repository_selected', { impl: 'in-memory' });
  return new InMemoryUseCaseRepository();
}

module.exports = { createUseCaseRepository };
