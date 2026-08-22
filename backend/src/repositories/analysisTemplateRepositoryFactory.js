'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryAnalysisTemplateRepository } = require('./InMemoryAnalysisTemplateRepository');
const { PostgresAnalysisTemplateRepository } = require('./PostgresAnalysisTemplateRepository');

function createAnalysisTemplateRepository() {
  if (config.db.enabled) {
    logger.info('analysis_template_repository_selected', { impl: 'postgres' });
    return new PostgresAnalysisTemplateRepository();
  }
  logger.info('analysis_template_repository_selected', { impl: 'in-memory' });
  return new InMemoryAnalysisTemplateRepository();
}

module.exports = { createAnalysisTemplateRepository };
