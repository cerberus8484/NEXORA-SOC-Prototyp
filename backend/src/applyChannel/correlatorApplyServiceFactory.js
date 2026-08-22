'use strict';

// P_CORR_ADMIN_2 Stufe 2 — Composition für den CorrelatorApplyService.
// Apply-Repo (Postgres bei DB_ENABLED, sonst InMemory) + ConfigRegistryService +
// ApplyExecutor mit Correlation-Health-Adapter + AuthService (Reauth-Verifikation).

const config = require('../config');
const { getApplyRepository } = require('./applyRepositoryFactory');
const { ConfigRegistryService } = require('../configRegistry/ConfigRegistryService');
const { getConfigRepository } = require('../configRegistry/configRepositoryFactory');
const { ApplyExecutor } = require('./ApplyExecutor');
const { buildCorrelationHealthAdapter } = require('./correlationHealthAdapter');
const { buildWorkerProbe } = require('./workerHealthProbe');
const { getWorkerStatusRepository } = require('./workerStatusRepositoryFactory');
const { CorrelatorApplyService } = require('./CorrelatorApplyService');
const { authService } = require('../services/AuthService');

// Eine feste Worker-Identität — der Correlation-Worker, der die eligible Caps liest.
const CORRELATION_WORKER_ID = 'correlation-worker';

function createCorrelatorApplyService() {
  const applyRepo = getApplyRepository();
  // Stufe 3: echte Live-Probe aus dem persistenten Worker-Status (fail-closed).
  const workerProbe = buildWorkerProbe({
    workerStatusRepo: getWorkerStatusRepository(),
    workerId: CORRELATION_WORKER_ID,
    heartbeatMaxAgeMs: (config.apply && config.apply.heartbeatMaxAgeMs) || 30000,
  });
  const executor = new ApplyExecutor({
    repo: applyRepo,
    workerHealth: buildCorrelationHealthAdapter({ applyRepo, workerProbe }),
    healthTimeoutMs: (config.apply && config.apply.healthTimeoutMs) || 10000,
  });
  return new CorrelatorApplyService({
    applyRepo,
    configService: new ConfigRegistryService({ repo: getConfigRepository() }),
    executor,
    authService,
    workerStatusRepo: getWorkerStatusRepository(),
    workerId: CORRELATION_WORKER_ID,
    heartbeatMaxAgeMs: (config.apply && config.apply.heartbeatMaxAgeMs) || 30000,
  });
}

module.exports = { createCorrelatorApplyService };
