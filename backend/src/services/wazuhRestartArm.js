'use strict';

// Reine Auswertung des Scharfschalt-Zustands für den Wazuh-Manager-Restart.
//
// Der Restart-Gate ist scharf, wenn ENTWEDER der ENV-Fallback (Betriebs-Opt-in
// via WAZUH_MANAGER_RESTART_ENABLED) ODER das per UI persistierte DB-Flag gesetzt
// ist. Die ENV bleibt bewusst als Override/Fallback erhalten (Operator ohne UI-
// Zugang, Break-Glass). Pure Funktion → voll unit-testbar, keine Seiteneffekte,
// fail-closed (nur ein echtes `true` schaltet scharf).

/**
 * Ist der Wazuh-Manager-Restart aktuell scharfgeschaltet?
 * ENV ODER DB-Flag genügt (ENV bleibt Fallback/Override).
 *
 * @param {{ envEnabled?: boolean, dbArmed?: boolean }} params
 * @returns {boolean}
 */
function isWazuhRestartArmed({ envEnabled, dbArmed } = {}) {
  return envEnabled === true || dbArmed === true;
}

/**
 * Woher stammt die Scharfschaltung? ENV hat Vorrang in der Anzeige (Break-Glass/
 * Betrieb), sonst UI, sonst null (nicht scharf). Rein informativ für die UI.
 *
 * @param {{ envEnabled?: boolean, dbArmed?: boolean }} params
 * @returns {'env' | 'ui' | null}
 */
function wazuhRestartArmSource({ envEnabled, dbArmed } = {}) {
  if (envEnabled === true) return 'env';
  if (dbArmed === true) return 'ui';
  return null;
}

module.exports = { isWazuhRestartArmed, wazuhRestartArmSource };
