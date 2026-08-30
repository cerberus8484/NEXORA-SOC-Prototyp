'use strict';

const config                         = require('../config');
const logger                         = require('../logger');
const { InMemorySettingsRepository } = require('./InMemorySettingsRepository');
const { PostgresSettingsRepository } = require('./PostgresSettingsRepository');

// Singleton-Instanz für den InMemory-Fall.
// Alle Aufrufer (settings-Route, passwordPolicyLoader, …) teilen sich dieselbe Instanz,
// sodass PUT /settings/platform sofort für loadPasswordPolicy() sichtbar wird.
// In Postgres-Produktions-Betrieb ist das irrelevant — dort teilt die DB den Zustand.
let _inMemoryInstance = null;

function createSettingsRepository() {
  if (config.db.enabled) {
    logger.info('settings_repository_selected', { impl: 'postgres' });
    return new PostgresSettingsRepository();
  }
  if (!_inMemoryInstance) {
    logger.info('settings_repository_selected', { impl: 'in-memory' });
    _inMemoryInstance = new InMemorySettingsRepository();
  }
  return _inMemoryInstance;
}

/** Nur für Tests: Singleton zurücksetzen, damit Tests eine frische Instanz bekommen. */
function _resetInMemoryInstance() {
  _inMemoryInstance = null;
}

module.exports = { createSettingsRepository, _resetInMemoryInstance };
