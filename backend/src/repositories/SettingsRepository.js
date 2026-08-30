'use strict';

/**
 * SettingsRepository — Interface.
 * Implementierungen: InMemorySettingsRepository (Tests/Dev), PostgresSettingsRepository (Prod).
 */
class SettingsRepository {
  // eslint-disable-next-line no-unused-vars
  async get(key)                    { this._ni('get'); }
  // eslint-disable-next-line no-unused-vars
  async set(key, value, actorEmail) { this._ni('set'); }
  async getAll()                    { this._ni('getAll'); }

  _ni(m) { throw new Error(`SettingsRepository.${m}() ist nicht implementiert`); }
}

module.exports = { SettingsRepository };
