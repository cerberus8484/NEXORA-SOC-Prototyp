'use strict';

// Wählt die TI-Cache-Implementierung: Postgres (persistent) bei DB_ENABLED, sonst InMemory.
const config = require('../../config');
const logger = require('../../logger');
const { InMemoryThreatIntelCache } = require('./ThreatIntelCacheRepository');
const { PostgresThreatIntelCache } = require('./PostgresThreatIntelCache');

function createThreatIntelCache() {
  if (config.db.enabled) {
    logger.info('threat_intel_cache_selected', { impl: 'postgres' });
    return new PostgresThreatIntelCache();
  }
  logger.info('threat_intel_cache_selected', { impl: 'in-memory' });
  return new InMemoryThreatIntelCache();
}

module.exports = { createThreatIntelCache };
