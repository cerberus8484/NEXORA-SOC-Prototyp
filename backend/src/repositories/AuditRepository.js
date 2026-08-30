'use strict';

/**
 * AuditRepository — Interface (append-only).
 * Implementierung: PostgresAuditRepository.
 * Im InMemory-/Test-Betrieb nutzt AuditService stattdessen seinen internen _log.
 */
class AuditRepository {
  // eslint-disable-next-line no-unused-vars
  async save(entry) { this._ni('save'); }

  _ni(m) { throw new Error(`AuditRepository.${m}() ist nicht implementiert`); }
}

module.exports = { AuditRepository };
