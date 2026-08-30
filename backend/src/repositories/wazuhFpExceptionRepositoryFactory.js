'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryWazuhFpExceptionRepository } = require('./InMemoryWazuhFpExceptionRepository');
const { PostgresWazuhFpExceptionRepository } = require('./PostgresWazuhFpExceptionRepository');

// Wählt die Implementierung wie die übrigen Repositories (DB_ENABLED → Postgres, sonst InMemory).
function createWazuhFpExceptionRepository() {
  if (config.db.enabled) {
    logger.info('wazuh_fp_repository_selected', { impl: 'postgres' });
    return new PostgresWazuhFpExceptionRepository();
  }
  logger.info('wazuh_fp_repository_selected', { impl: 'in-memory' });
  return new InMemoryWazuhFpExceptionRepository();
}

module.exports = { createWazuhFpExceptionRepository };
