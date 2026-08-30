'use strict';

const config                       = require('../config');
const logger                       = require('../logger');
const { InMemoryTicketRepository } = require('./InMemoryTicketRepository');
const { PostgresTicketRepository } = require('./PostgresTicketRepository');

/**
 * Wählt die Ticket-Repository-Implementierung anhand der App-Konfiguration.
 *   config.db.enabled === true → Postgres (restart-fest), sonst InMemory (Tests/Dev).
 */
function createTicketRepository() {
  if (config.db.enabled) {
    logger.info('ticket_repository_selected', { impl: 'postgres' });
    return new PostgresTicketRepository();
  }
  logger.info('ticket_repository_selected', { impl: 'in-memory' });
  return new InMemoryTicketRepository();
}

module.exports = { createTicketRepository };
