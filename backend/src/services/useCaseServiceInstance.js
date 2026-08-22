'use strict';

const { UseCaseService } = require('./UseCaseService');
const { createUseCaseRepository } = require('../repositories/useCaseRepositoryFactory');

const useCaseService = new UseCaseService({ repo: createUseCaseRepository() });

module.exports = { useCaseService };
