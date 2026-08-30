'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Control-Adapter `ssh-powershell` — installiert den Wazuh-Agent auf einem BESTEHENDEN
// Windows-Host, indem er den bekannten Installer (deploy/install-wazuh-agent.ps1) auf
// dem Ziel per SSH (OpenSSH-Server) ausführt. Pendant zum `ssh-systemd`-Adapter (Linux).
//
// SICHERHEIT (RCE-Fläche!) — identisches Muster wie sshSystemdAdapter:
//   - strikte Eingabe-Validierung (Defense-in-Depth, zusätzlich zu deployParamValidation);
//   - Werte gehen als strukturierte ENV an den Installer — NIE in eine Shell-Command-Zeile;
//   - der SSH-Transport ist als `runner` INJIZIERT → der Adapter kennt keinen Key/kein Secret;
//   - der Runner wählt Remote-Shell (powershell) + ENV-Stil ($env:) FEST anhand der scriptId;
//   - fail-closed: alles außer Exit 0 = Fehlschlag; roher Fehler nur ins Log.
//
// Runner-Vertrag (wie beim Linux-Adapter):
//   runner({ host, user, port, env, scriptId, timeoutMs }) → Promise<{ code, timedOut? }>
//   scriptId ist der Allowlist-Key 'install-wazuh-agent-windows'.
// ─────────────────────────────────────────────────────────────────────────────

const logger = require('../../logger');

const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;            // IP oder DNS, keine Shell-Metazeichen
// SSH-Username für Windows: deckt lokale Konten (Administrator, nexora-svc) ab. Injektionssicher
// (kein Space/Quote/Metazeichen); der Wert ist ein ssh2-Protokollfeld, keine Shell-Interpolation.
const WIN_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const NAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;            // Agent-Name

const DEFAULT_AGENT_VERSION = '4.14.6';
const DEFAULT_TIMEOUT_MS = 300000; // 5 min — msiexec-Install kann dauern

class DeployAdapterError extends Error {
  constructor(message) { super(message); this.name = 'DeployAdapterError'; }
}

/** Strikte Validierung + Normalisierung der Adapter-Parameter (fail-fast). */
function validateParams(p = {}) {
  const targetHost = String(p.targetHost ?? '');
  const wazuhManager = String(p.wazuhManager ?? '');
  const sshUser = String(p.sshUser ?? 'Administrator');
  const sshPort = p.sshPort ?? 22;
  const agentName = p.agentName != null && p.agentName !== '' ? String(p.agentName) : targetHost;

  if (!HOST_RE.test(targetHost))     throw new DeployAdapterError('ungültiger targetHost');
  if (!HOST_RE.test(wazuhManager))   throw new DeployAdapterError('ungültiger wazuhManager');
  if (!WIN_USER_RE.test(sshUser))    throw new DeployAdapterError('ungültiger sshUser');
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new DeployAdapterError('ungültiger sshPort');
  if (!NAME_RE.test(agentName))      throw new DeployAdapterError('ungültiger agentName');

  return { targetHost, wazuhManager, sshUser, sshPort, agentName };
}

/**
 * Installiert den Wazuh-Agent auf dem Windows-Ziel-Host (idempotent — der Installer
 * lässt einen bereits installierten Agent unangetastet). Gibt ein strukturiertes,
 * redigiertes Ergebnis zurück (nie rohe Fehler/Secrets).
 *
 * @param {object} params  targetHost, wazuhManager, sshUser?, sshPort?, agentName?
 * @param {{ runner: Function, timeoutMs?: number }} deps  injizierter SSH-Runner
 * @returns {Promise<{ ok: boolean, installed: boolean, host?: string, agentName?: string, reason?: string, message?: string }>}
 */
async function installWindowsAgent(params, deps = {}) {
  const { runner, timeoutMs = DEFAULT_TIMEOUT_MS } = deps;
  if (typeof runner !== 'function') throw new DeployAdapterError('runner (SSH-Transport) ist erforderlich');

  const v = validateParams(params); // wirft bei ungültiger Eingabe (Defense-in-Depth)

  // Strukturierte ENV — validierte Werte, kein Shell-Interpolieren. Der Runner stellt
  // sie als `$env:`-Preamble voran; der .ps1-Installer liest sie aus der Umgebung.
  const env = {
    WAZUH_MANAGER: v.wazuhManager,
    WAZUH_AGENT_NAME: v.agentName,
    WAZUH_AGENT_VERSION: DEFAULT_AGENT_VERSION,
  };

  let result;
  try {
    result = await runner({
      host: v.targetHost, user: v.sshUser, port: v.sshPort,
      env, scriptId: 'install-wazuh-agent-windows', timeoutMs,
    });
  } catch (e) {
    logger.warn('ssh_powershell_adapter_error', { host: v.targetHost, message: e && e.message });
    return { ok: false, installed: false, reason: 'ssh_error', message: 'SSH-Ausführung fehlgeschlagen.' };
  }

  if (result && result.timedOut) {
    logger.warn('ssh_powershell_adapter_timeout', { host: v.targetHost, timeoutMs });
    return { ok: false, installed: false, reason: 'timeout', message: 'Zeitüberschreitung bei der Installation.' };
  }
  if (!result || result.code !== 0) {
    logger.warn('ssh_powershell_adapter_nonzero', { host: v.targetHost, code: result && result.code });
    return { ok: false, installed: false, reason: 'install_failed', message: 'Agent-Installation fehlgeschlagen.' };
  }

  logger.info('ssh_powershell_agent_installed', { host: v.targetHost, agentName: v.agentName });
  return { ok: true, installed: true, host: v.targetHost, agentName: v.agentName };
}

module.exports = { installWindowsAgent, validateParams, DeployAdapterError };
