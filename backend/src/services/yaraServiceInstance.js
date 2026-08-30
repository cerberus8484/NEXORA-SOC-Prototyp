'use strict';

const { YaraService } = require('./YaraService');
const { createYaraRepository } = require('../repositories/yaraRepositoryFactory');

const yaraService = new YaraService({ repo: createYaraRepository() });

module.exports = { yaraService };
