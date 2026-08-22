'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryCustodyRepository } = require('./InMemoryCustodyRepository');
const { PostgresCustodyRepository } = require('./PostgresCustodyRepository');

function createCustodyRepository() {
  if (config.db.enabled) {
    logger.info('custody_repository_selected', { impl: 'postgres' });
    return new PostgresCustodyRepository();
  }
  logger.info('custody_repository_selected', { impl: 'in-memory' });
  return new InMemoryCustodyRepository();
}

module.exports = { createCustodyRepository };
