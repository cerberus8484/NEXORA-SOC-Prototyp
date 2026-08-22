'use strict';

const { AnalysisTemplateService } = require('./AnalysisTemplateService');
const { createAnalysisTemplateRepository } = require('../repositories/analysisTemplateRepositoryFactory');

const analysisTemplateService = new AnalysisTemplateService({ repo: createAnalysisTemplateRepository() });

module.exports = { analysisTemplateService };
