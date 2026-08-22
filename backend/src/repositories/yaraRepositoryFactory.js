'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryYaraRepository } = require('./InMemoryYaraRepository');
const { PostgresYaraRepository } = require('./PostgresYaraRepository');

function createYaraRepository() {
  if (config.db.enabled) {
    logger.info('yara_repository_selected', { impl: 'postgres' });
    return new PostgresYaraRepository();
  }
  logger.info('yara_repository_selected', { impl: 'in-memory' });
  return new InMemoryYaraRepository();
}

module.exports = { createYaraRepository };
