'use strict';

const config = require('../config');
const logger = require('../logger');
const { InMemoryQueueService } = require('./InMemoryQueueService');

/**
 * Wählt die Queue-Implementierung.
 *
 * Bei DB_ENABLED=true → persistente pg-boss-Queue. **KEIN stiller Fallback auf InMemory:**
 * ist die persistente Queue nicht verfügbar, propagiert der Fehler beim späteren
 * `queue.start()` sichtbar (der Aufrufer/Startup MUSS ihn behandeln, nicht auf InMemory
 * zurückfallen). Die InMemory-Queue ist ausschließlich Dev/Test-Fallback (DB_ENABLED=false).
 */
function createQueueService() {
  if (config.db.enabled) {
    // Lazy require: ESM-pg-boss nur im Postgres-Pfad laden (Jest-Unit-Suite lädt es nie).
    const { PgBossQueueService } = require('./PgBossQueueService');
    logger.info('queue_service_selected', { impl: 'pg-boss' });
    return new PgBossQueueService();
  }
  logger.info('queue_service_selected', { impl: 'in-memory' });
  return new InMemoryQueueService();
}

module.exports = { createQueueService };
