'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryAgentSuggestionRepository } = require('./InMemoryAgentSuggestionRepository');
const { PostgresAgentSuggestionRepository } = require('./PostgresAgentSuggestionRepository');

/** Wählt die Agent-Suggestion-Repository-Implementierung anhand der Konfiguration. */
function createAgentSuggestionRepository() {
  if (config.db.enabled) {
    logger.info('agent_suggestion_repository_selected', { impl: 'postgres' });
    return new PostgresAgentSuggestionRepository();
  }
  logger.info('agent_suggestion_repository_selected', { impl: 'in-memory' });
  return new InMemoryAgentSuggestionRepository();
}

module.exports = { createAgentSuggestionRepository };
