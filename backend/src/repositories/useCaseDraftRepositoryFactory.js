'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryUseCaseDraftRepository } = require('./InMemoryUseCaseDraftRepository');
const { PostgresUseCaseDraftRepository } = require('./PostgresUseCaseDraftRepository');

/**
 * Wählt die UseCaseDraft-Repository-Implementierung anhand der Konfiguration.
 * DB_ENABLED=true → Postgres, sonst InMemory (Tests/Dev).
 */
function createUseCaseDraftRepository() {
  if (config.db.enabled) {
    logger.info('use_case_draft_repository_selected', { impl: 'postgres' });
    return new PostgresUseCaseDraftRepository();
  }
  logger.info('use_case_draft_repository_selected', { impl: 'in-memory' });
  return new InMemoryUseCaseDraftRepository();
}

module.exports = { createUseCaseDraftRepository };
