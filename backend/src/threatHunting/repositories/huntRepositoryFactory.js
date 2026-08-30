'use strict';

const config                      = require('../../config');
const logger                      = require('../../logger');
const { InMemoryHuntRepository }  = require('./InMemoryHuntRepository');
const { PostgresHuntRepository }  = require('./PostgresHuntRepository');

/**
 * Wählt die Hunt-Repository-Implementierung anhand der App-Konfiguration.
 *
 *   config.db.enabled === true  → PostgresHuntRepository (restart-fest)
 *   sonst                       → InMemoryHuntRepository  (Tests / Dev ohne DB)
 *
 * Beide erfüllen denselben Vertrag (LSP), HuntService merkt keinen Unterschied.
 */
function createHuntRepository() {
  if (config.db.enabled) {
    logger.info('hunt_repository_selected', { impl: 'postgres', db: config.db.name });
    return new PostgresHuntRepository();
  }
  logger.info('hunt_repository_selected', { impl: 'in-memory' });
  return new InMemoryHuntRepository();
}

module.exports = { createHuntRepository };
