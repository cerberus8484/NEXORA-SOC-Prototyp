'use strict';

// Reine Preflight-Statusberechnung fürs Deployment Center „Systemstatus"-Panel.
// Kein I/O — der Aufrufer reicht die rohen Fakten hinein, diese Funktion leitet den
// anzeigbaren Zwei-Schlüssel-Zustand + strukturierte Checks (grün/rot) ab.
//
// Zwei-Schlüssel: EFFEKTIV scharf nur, wenn der env-Boden (Kommissionierung) UND der
// DB-Arm-Toggle (Betrieb) beide an sind. Die Boot-Bedingungen (Hypervisor-Allowlist,
// dediziertes SETTINGS_ENC_KEY) sind Voraussetzungen fürs Armen — ohne sie würde die
// API bei env=true gar nicht booten (validateEnv, fail-fast), daher hier als Blocker.

/**
 * @typedef {Object} PreflightFacts
 * @property {boolean} floorEnabled           env DEPLOY_ENABLED (Kommissionierung)
 * @property {boolean} armed                  DB-Arm-Toggle (Betrieb)
 * @property {boolean} hypervisorAllowlistSet DEPLOY_HYPERVISOR_ALLOWED_HOSTS nicht leer
 * @property {boolean} encKeyDedicated        SETTINGS_ENC_KEY dediziert (≥16, nicht JWT-Fallback)
 */

/**
 * @param {PreflightFacts} facts
 * @returns {{
 *   effectiveEnabled: boolean, state: string, canArm: boolean,
 *   blockers: string[], checks: Array<{id:string,label:string,ok:boolean,hint?:string}>
 * }}
 */
function computeDeployPreflight(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const floorEnabled = f.floorEnabled === true;
  const armed = f.armed === true;
  const hypervisorAllowlistSet = f.hypervisorAllowlistSet === true;
  const encKeyDedicated = f.encKeyDedicated === true;

  // Boot-Bedingungen — Voraussetzungen fürs Armen (spiegeln validateEnv).
  const blockers = [];
  if (!hypervisorAllowlistSet) blockers.push('DEPLOY_HYPERVISOR_ALLOWED_HOSTS ist leer (SSRF-Allowlist erforderlich)');
  if (!encKeyDedicated) blockers.push('SETTINGS_ENC_KEY ist nicht dediziert (Key-Separation erforderlich)');

  const checks = [
    { id: 'floor', label: 'Kommissioniert (DEPLOY_ENABLED)', ok: floorEnabled,
      hint: floorEnabled ? undefined : 'Operator setzt den env-Boden out-of-band.' },
    { id: 'hypervisorAllowlist', label: 'Hypervisor-Allowlist gesetzt', ok: hypervisorAllowlistSet,
      hint: hypervisorAllowlistSet ? undefined : 'Erlaubte Hypervisor-Hosts konfigurieren.' },
    { id: 'encKey', label: 'Verschlüsselungs-Key dediziert', ok: encKeyDedicated,
      hint: encKeyDedicated ? undefined : 'SETTINGS_ENC_KEY vom JWT_SECRET entkoppeln (ohne Secrets zu brechen).' },
    { id: 'armed', label: 'Betrieblich scharf (Arm-Toggle)', ok: armed,
      hint: armed ? undefined : 'Im Deployment Center armen (Step-up + Audit).' },
  ];

  // Armen ist nur möglich, wenn kommissioniert UND keine Boot-Bedingung offen ist.
  const canArm = floorEnabled && blockers.length === 0;
  const effectiveEnabled = floorEnabled && armed;

  let state;
  if (!floorEnabled) state = 'not_commissioned';
  else if (effectiveEnabled) state = 'armed';
  else state = 'disarmed';

  return { effectiveEnabled, state, canArm, blockers, checks };
}

module.exports = { computeDeployPreflight };
