'use strict';

const config = require('../../../config');
const logger = require('../../../logger');
const { InMemoryOffenseNoteRepository }  = require('./InMemoryOffenseNoteRepository');
const { PostgresOffenseNoteRepository }  = require('./PostgresOffenseNoteRepository');

/**
 * Wählt die OffenseNote-Repository-Implementierung anhand der App-Konfiguration.
 *
 *   config.db.enabled === true  → PostgresOffenseNoteRepository (restart-fest)
 *   sonst                       → InMemoryOffenseNoteRepository  (Tests / Dev ohne DB)
 *
 * Folgt exakt dem Muster von ticketRepositoryFactory.js (LSP — gleicher Vertrag).
 */
function createOffenseNoteRepository() {
  if (config.db.enabled) {
    logger.info('offense_note_repository_selected', { impl: 'postgres' });
    return new PostgresOffenseNoteRepository();
  }
  logger.info('offense_note_repository_selected', { impl: 'in-memory' });
  return new InMemoryOffenseNoteRepository();
}

// Singleton — wird einmal beim Appstart gebaut, danach geteilt.
const offenseNoteRepository = createOffenseNoteRepository();

module.exports = { offenseNoteRepository, createOffenseNoteRepository };
