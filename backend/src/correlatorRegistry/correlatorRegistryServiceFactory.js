'use strict';

// P_CORR_ADMIN_1 — Composition für den CorrelatorRegistryService.
// Read-only: Correlation-Repo (Postgres bei DB_ENABLED, sonst InMemory) +
// ConfigRegistryService (P_CONFIG_1). KEIN Apply/Queue/Runtime nötig.

const { CorrelatorRegistryService } = require('./correlatorRegistryService');
const { createCorrelationRepository } = require('../repositories/correlationRepositoryFactory');
const { ConfigRegistryService } = require('../configRegistry/ConfigRegistryService');
const { getConfigRepository } = require('../configRegistry/configRepositoryFactory');

let _correlationRepo = null;
function correlationRepo() {
  if (!_correlationRepo) _correlationRepo = createCorrelationRepository();
  return _correlationRepo;
}

/** Frischer Service je Request (zustandslos); Repos sind Prozess-Singletons. */
function createCorrelatorRegistryService() {
  return new CorrelatorRegistryService({
    correlationRepo: correlationRepo(),
    configService: new ConfigRegistryService({ repo: getConfigRepository() }),
  });
}

module.exports = { createCorrelatorRegistryService };
