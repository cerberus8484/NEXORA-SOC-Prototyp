'use strict';

// Persistenz des Scharfschalt-Flags für den Wazuh-Manager-Restart.
//
// Bewusst NICHT über PUT /settings/platform gesetzt: das ist ein
// sicherheitsrelevantes Flag mit Passwort-Step-up (arm-Route). Ein generischer
// Settings-PUT würde die Passwort-Bestätigung umgehen. Daher ein dedizierter,
// schmaler Store, der ausschließlich von den arm/disarm-Routen und dem
// Services-Gate genutzt wird. Persistenz teilt sich die bestehende
// platform_settings-Key-Value-Tabelle (Prefix platform_) — KEINE neue Migration
// nötig, da das Schema generisch (key/value) ist.

const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');

const ARM_KEY = 'platform_wazuhManagerRestartArmed';

// Lazily erstellter, geteilter Repo-Handle (InMemory-Singleton bzw. Postgres).
let _repo = null;
function repo() {
  if (!_repo) _repo = createSettingsRepository();
  return _repo;
}

/**
 * Aktuellen DB-Scharfschalt-Zustand lesen. Default false (fail-closed):
 * fehlender/ungesetzter Wert = nicht scharf. Nur ein echtes `true` gilt als scharf.
 *
 * @returns {Promise<boolean>}
 */
async function isArmed() {
  const stored = await repo().get(ARM_KEY);
  return stored === true;
}

/**
 * DB-Scharfschalt-Flag setzen (idempotent). Persistiert genau einen Boolean.
 *
 * @param {boolean} armed
 * @returns {Promise<boolean>} der gesetzte Zustand
 */
async function setArmed(armed) {
  const next = armed === true;
  await repo().set(ARM_KEY, next);
  return next;
}

/** Nur für Tests: injizierbaren Repo setzen/zurücksetzen. */
function _setRepoForTests(fake) {
  _repo = fake;
}

module.exports = { isArmed, setArmed, ARM_KEY, _setRepoForTests };
