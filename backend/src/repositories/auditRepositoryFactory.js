'use strict';

const config                      = require('../config');
const logger                      = require('../logger');
const { PostgresAuditRepository } = require('./PostgresAuditRepository');

/**
 * Audit-Repository-Auswahl.
 *   config.db.enabled === true → PostgresAuditRepository
 *   sonst                      → null  (AuditService nutzt seinen internen _log;
 *                                        nötig für getLog()/clearLog() in Tests)
 */
function createAuditRepository() {
  if (config.db.enabled) {
    logger.info('audit_repository_selected', { impl: 'postgres' });
    return new PostgresAuditRepository();
  }
  logger.info('audit_repository_selected', { impl: 'in-memory(_log)' });
  return null;
}

module.exports = { createAuditRepository };
