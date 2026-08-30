'use strict';

// Reiner Service-Registry-Katalog für steuerbare Infrastruktur-Dienste.
//
// KEINE Restart-Logik hier — der eigentliche Neustart bleibt am bestehenden
// Endpoint POST /wazuh/manager/restart. Dieser Katalog beschreibt nur, WELCHE
// Dienste steuerbar sind und OB ihr Restart aktuell möglich ist (mit ehrlicher
// Begründung, warum nicht). Pure Funktion → voll unit-testbar, keine Seiteneffekte.
//
// Erweiterbar: der Katalog ist ein Array — weitere Dienste (z. B. Indexer,
// Filebeat) lassen sich als zusätzliche Einträge ergänzen, ohne die Signatur
// zu ändern.

const { isWazuhRestartArmed, wazuhRestartArmSource } = require('./wazuhRestartArm');

/**
 * Leitet den Restart-Zustand des Wazuh-Managers ehrlich ab.
 *
 * `enabled` ist nur wahr, wenn der Dienst scharfgeschaltet (ENV ODER UI) UND die
 * Wazuh-API konfiguriert ist; andernfalls nennt `disabledReason` den konkreten
 * Grund. Fehlende Konfiguration hat Vorrang — ohne konfigurierte API ist selbst
 * bei scharfgeschaltetem Flag kein Neustart möglich (ehrlich, kein Fake).
 *
 * @param {{ armed: boolean, configured: boolean }} gate
 * @returns {{ supported: true, enabled: boolean, disabledReason: string | null }}
 */
function deriveRestart({ armed, configured }) {
  if (!configured) {
    return { supported: true, enabled: false, disabledReason: 'Wazuh-API nicht konfiguriert' };
  }
  if (!armed) {
    return { supported: true, enabled: false, disabledReason: 'Nicht scharfgeschaltet' };
  }
  return { supported: true, enabled: true, disabledReason: null };
}

function deriveConnection(connection) {
  const apiConfigured = connection?.apiConfigured === true;
  const indexerConfigured = connection?.indexerConfigured === true;
  return {
    configured: apiConfigured || indexerConfigured,
    apiConfigured,
    indexerConfigured,
  };
}

/**
 * Baut den managed-services-Katalog aus dem Live-Zustand.
 *
 * @param {{
 *   managerRestartEnabled?: boolean,  // ENV-Fallback (WAZUH_MANAGER_RESTART_ENABLED)
 *   managerRestartArmed?: boolean,    // per UI persistiertes DB-Flag
 *   wazuhConfigured?: boolean,
 *   wazuhConnection?: {
 *     apiConfigured?: boolean,
 *     indexerConfigured?: boolean
 *   }
 * }} state
 * @returns {Array<{
 *   id: string, name: string, description: string, category: string,
 *   armed: boolean, armSource: ('env'|'ui'|null),
 *   connection: { configured: boolean, apiConfigured: boolean, indexerConfigured: boolean },
 *   restart: { supported: true, enabled: boolean, disabledReason: string | null }
 * }>}
 */
function buildServiceControlCatalog(state = {}) {
  const envEnabled = state.managerRestartEnabled === true;
  const dbArmed = state.managerRestartArmed === true;
  const connection = deriveConnection(
    state.wazuhConnection || { apiConfigured: state.wazuhConfigured === true, indexerConfigured: false },
  );
  const wazuhConfigured = connection.apiConfigured;

  const armed = isWazuhRestartArmed({ envEnabled, dbArmed });
  const armSource = wazuhRestartArmSource({ envEnabled, dbArmed });

  return [
    {
      id: 'wazuh-manager',
      name: 'Wazuh Manager',
      description:
        'Zentraler Wazuh-Manager (Ruleset & Analyse-Engine). Ein Neustart lädt geänderte '
        + 'Regeln — z. B. nach einer validierten False-Positive-Ausnahme. Der Manager ist '
        + 'dabei kurz offline; die Konfiguration wird vor dem Neustart geprüft.',
      category: 'SIEM',
      armed,
      armSource,
      connection,
      restart: deriveRestart({ armed, configured: wazuhConfigured }),
    },
  ];
}

module.exports = { buildServiceControlCatalog };
