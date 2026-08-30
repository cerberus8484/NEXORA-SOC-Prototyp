'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryEvidenceRepository } = require('./InMemoryEvidenceRepository');
const { PostgresEvidenceRepository } = require('./PostgresEvidenceRepository');

// DB_ENABLED → Postgres, sonst InMemory (wie die übrigen Repositories).
function createEvidenceRepository() {
  if (config.db.enabled) {
    logger.info('evidence_repository_selected', { impl: 'postgres' });
    return new PostgresEvidenceRepository();
  }
  logger.info('evidence_repository_selected', { impl: 'in-memory' });
  return new InMemoryEvidenceRepository();
}

module.exports = { createEvidenceRepository };
