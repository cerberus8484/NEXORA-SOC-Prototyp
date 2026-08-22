'use strict';

// Persistenz des Deploy-Scharfschalt-Flags — die Betriebs-Ebene des Zwei-Schlüssel-
// Modells fürs Deployment Center.
//
// Der env-Boden DEPLOY_ENABLED bleibt die Kommissionierung (out-of-band, kann ein
// App-Kompromiss NICHT umlegen). DIESER Store ist der Alltags-Toggle darüber: armen/
// entwaffnen über die UI, mit Passwort-Step-up + Audit auf der Route (NICHT über den
// generischen Settings-PUT, der die Step-up-Prüfung umginge — analog zum
// wazuhRestartArmStore).
//
// EFFEKTIV scharf ist Deploy nur, wenn BEIDE Schlüssel an sind (Komposition in der
// deployServiceFactory). Persistenz teilt sich die generische platform_settings-
// Key-Value-Tabelle (Prefix platform_) — keine neue Migration nötig.

const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');

const ARM_KEY = 'platform_deployArmed';

let _repo = null;
function repo() {
  if (!_repo) _repo = createSettingsRepository();
  return _repo;
}

/**
 * DB-Scharfschalt-Zustand lesen. Default false (fail-closed): nur ein echtes
 * Boolean `true` gilt als scharf — ein String 'true' o.ä. zählt NICHT.
 * @returns {Promise<boolean>}
 */
async function isArmed() {
  const stored = await repo().get(ARM_KEY);
  return stored === true;
}

/**
 * DB-Scharfschalt-Flag setzen (idempotent). Persistiert genau einen Boolean;
 * nicht-boolean Eingaben werden fail-closed auf false normalisiert.
 * @param {boolean} armed
 * @returns {Promise<boolean>} der gesetzte Zustand
 */
async function setArmed(armed) {
  const next = armed === true;
  await repo().set(ARM_KEY, next);
  return next;
}

/** Nur für Tests: injizierbaren Repo setzen/zurücksetzen. */
function _setRepoForTests(fake) { _repo = fake; }

module.exports = { isArmed, setArmed, ARM_KEY, _setRepoForTests };
