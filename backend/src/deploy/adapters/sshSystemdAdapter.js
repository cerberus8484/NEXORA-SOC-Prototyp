'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Control-Adapter `ssh-systemd` — installiert den Wazuh-Agent auf einem BESTEHENDEN
// Linux-Host, indem er den bekannten Installer (deploy/install-wazuh-agent.sh) auf
// dem Ziel per SSH ausführt.
//
// SICHERHEIT (RCE-Fläche!):
//   - strikte Eingabe-Validierung (Defense-in-Depth, zusätzlich zu deployParamValidation);
//   - Werte gehen als strukturierte ENV an den Installer — NIE in eine Shell-Command-Zeile
//     interpoliert; die erlaubten Zeichensätze schließen Shell-Metazeichen ohnehin aus;
//   - der SSH-Transport ist als `runner` INJIZIERT → der Adapter kennt keinen Key/kein
//     Secret (kann also keins leaken); reale Transport-Impl getrennt + security-reviewed;
//   - fail-closed: alles außer Exit 0 = Fehlschlag; roher Fehler nur ins Log, nie zurück;
//   - Timeout wird durchgereicht.
//
// Runner-Vertrag:
//   runner({ host, user, port, env, scriptId, timeoutMs }) → Promise<{ code, stdout?, stderr?, timedOut? }>
//   `scriptId` ist ein Allowlist-Key ('install-wazuh-agent') — der Runner mappt ihn auf den
//   FESTEN Installer-Pfad (kein Pfad aus Nutzereingabe). `env` sind validierte Key-Values.
// ─────────────────────────────────────────────────────────────────────────────

const logger = require('../../logger');

const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;   // IP oder DNS, keine Shell-Metazeichen
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/; // POSIX-Username
const NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;   // Agent-Name

// Ziel-Betriebssystem — STRIKTE Allowlist. Der Installer mappt jeden Wert auf eine
// FESTE Paketmanager-Familie (apt/dnf/zypper); es geht NIE ein roher OS-String in einen
// Befehl. Ein nicht gelisteter Wert wird fail-closed abgelehnt (Default = debian, damit
// bestehende Deploys ohne os-Angabe unverändert apt/Debian nutzen).
const OS_ALLOWLIST = new Set([
  'debian', 'ubuntu',                                     // apt (dpkg)
  'rhel', 'centos', 'rocky', 'alma', 'fedora', 'amazon',  // dnf/yum (rpm)
  'sles', 'opensuse',                                     // zypper (rpm)
]);
const DEFAULT_OS = 'debian';

const DEFAULT_AGENT_VERSION = '4.14.6';
const DEFAULT_TIMEOUT_MS = 300000; // 5 min — apt-Install kann dauern

class DeployAdapterError extends Error {
  constructor(message) { super(message); this.name = 'DeployAdapterError'; }
}

/** Strikte Validierung + Normalisierung der Adapter-Parameter (fail-fast). */
function validateParams(p = {}) {
  const targetHost = String(p.targetHost ?? '');
  const wazuhManager = String(p.wazuhManager ?? '');
  const sshUser = String(p.sshUser ?? 'root');
  const sshPort = p.sshPort ?? 22;
  const agentName = p.agentName != null && p.agentName !== '' ? String(p.agentName) : targetHost;
  const os = p.os != null && p.os !== '' ? String(p.os).toLowerCase() : DEFAULT_OS;

  if (!HOST_RE.test(targetHost))   throw new DeployAdapterError('ungültiger targetHost');
  if (!HOST_RE.test(wazuhManager)) throw new DeployAdapterError('ungültiger wazuhManager');
  if (!USER_RE.test(sshUser))      throw new DeployAdapterError('ungültiger sshUser');
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new DeployAdapterError('ungültiger sshPort');
  if (!NAME_RE.test(agentName))    throw new DeployAdapterError('ungültiger agentName');
  if (!OS_ALLOWLIST.has(os))       throw new DeployAdapterError('ungültiges os');

  return { targetHost, wazuhManager, sshUser, sshPort, agentName, os };
}

/**
 * Installiert den Wazuh-Agent auf dem Ziel-Host (idempotent — der Installer selbst
 * lässt einen bereits installierten Agent unangetastet). Gibt ein strukturiertes,
 * redigiertes Ergebnis zurück (nie rohe Fehler/Secrets).
 *
 * @param {object} params  targetHost, wazuhManager, sshUser?, sshPort?, agentName?
 * @param {{ runner: Function, timeoutMs?: number }} deps  injizierter SSH-Runner
 * @returns {Promise<{ ok: boolean, installed: boolean, host?: string, agentName?: string, reason?: string, message?: string }>}
 */
async function installLinuxAgent(params, deps = {}) {
  const { runner, timeoutMs = DEFAULT_TIMEOUT_MS } = deps;
  if (typeof runner !== 'function') throw new DeployAdapterError('runner (SSH-Transport) ist erforderlich');

  const v = validateParams(params); // wirft bei ungültiger Eingabe (Defense-in-Depth)

  // Strukturierte ENV — validierte Werte, kein Shell-Interpolieren.
  const env = {
    WAZUH_MANAGER: v.wazuhManager,
    WAZUH_AGENT_NAME: v.agentName,
    WAZUH_AGENT_VERSION: DEFAULT_AGENT_VERSION,
    WAZUH_AGENT_OS: v.os, // strikt allowlisted → Installer wählt apt/dnf/zypper
  };

  let result;
  try {
    result = await runner({
      host: v.targetHost, user: v.sshUser, port: v.sshPort,
      env, scriptId: 'install-wazuh-agent', timeoutMs,
    });
  } catch (e) {
    // Roher Fehler NUR ins Log (Topologie/Interna nicht nach außen).
    logger.warn('ssh_systemd_adapter_error', { host: v.targetHost, message: e && e.message });
    return { ok: false, installed: false, reason: 'ssh_error', message: 'SSH-Ausführung fehlgeschlagen.' };
  }

  if (result && result.timedOut) {
    logger.warn('ssh_systemd_adapter_timeout', { host: v.targetHost, timeoutMs });
    return { ok: false, installed: false, reason: 'timeout', message: 'Zeitüberschreitung bei der Installation.' };
  }
  if (!result || result.code !== 0) {
    logger.warn('ssh_systemd_adapter_nonzero', { host: v.targetHost, code: result && result.code });
    return { ok: false, installed: false, reason: 'install_failed', message: 'Agent-Installation fehlgeschlagen.' };
  }

  logger.info('ssh_systemd_agent_installed', { host: v.targetHost, agentName: v.agentName });
  return { ok: true, installed: true, host: v.targetHost, agentName: v.agentName };
}

module.exports = { installLinuxAgent, validateParams, DeployAdapterError };
