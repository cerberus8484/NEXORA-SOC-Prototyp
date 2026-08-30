'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Control-Adapter `ssh-ids-sensor` — installiert Suricata als IDS-Sensor auf
// einem bestehenden Linux-Host (Brownfield).
//
// BEWUSST kein Kollektor-Fabrik-Adapter: der IDS-Sensor hat eine ANDERE Form.
// Suricata kommt aus den Distributions-Paketquellen (GPG-Integrität durch den
// Paketmanager), nicht als Nexora-Binary — es gibt weder Version+SHA256 noch ein
// Release-Artefakt. Und er PUSHT nicht: Suricata schreibt EVE-JSON, das der
// Collector-Hub per SSH-tail abholt. Deshalb auch keine intakeUrl.
//
// Was er braucht: das zu überwachende Interface und die OS-Familie (Paketmanager).
// Beide gehen als validierte ENV an den Runner — nie in eine Befehlszeile.
//
// Auth-agnostisch wie die übrigen Adapter: der SSH-Transport wird als `runner`
// injiziert; dieser Adapter kennt weder Key noch Secret (leak-frei by design).
// ─────────────────────────────────────────────────────────────────────────

const HOST_RE = /^[a-zA-Z0-9.-]{1,253}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
// Netzwerk-Interface: Linux-Namen (eth0, ens18, enp3s0, br-lan). Bewusst eng —
// keine Leerzeichen/Shell-Metazeichen; der Wert benennt ein Gerät, kein Kommando.
const IFACE_RE = /^[a-zA-Z0-9._-]{1,15}$/;

// OS-Allowlist = Paketmanager-Familien, die der Installer kennt. MUSS mit der
// server-seitigen Enum im Katalog übereinstimmen (Server bleibt die Wahrheit).
const OS_ALLOWLIST = new Set([
  'debian', 'ubuntu', 'rhel', 'centos', 'rocky', 'alma', 'fedora', 'amazon', 'sles', 'opensuse',
]);

const DEFAULT_TIMEOUT_MS = 300000; // 5 min — Paketquelle + Suricata-Install + Regeln

class DeployAdapterError extends Error {
  constructor(message) { super(message); this.name = 'DeployAdapterError'; }
}

/** Strikte Validierung + Normalisierung (fail-fast, VOR jedem Runner-Aufruf). */
function validateParams(p = {}) {
  const targetHost       = String(p.targetHost ?? '');
  const sshUser          = String(p.sshUser ?? 'root');
  const sshPort          = p.sshPort ?? 22;
  const monitorInterface = String(p.monitorInterface ?? '');
  const os               = String(p.os ?? 'debian').toLowerCase();

  if (!HOST_RE.test(targetHost))  throw new DeployAdapterError('ungültiger targetHost');
  if (!USER_RE.test(sshUser))     throw new DeployAdapterError('ungültiger sshUser');
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new DeployAdapterError('ungültiger sshPort');
  if (!IFACE_RE.test(monitorInterface)) throw new DeployAdapterError('ungültiges monitorInterface');
  if (!OS_ALLOWLIST.has(os))      throw new DeployAdapterError(`nicht unterstütztes os: ${os}`);

  return { targetHost, sshUser, sshPort, monitorInterface, os };
}

/**
 * Installiert den Suricata-IDS-Sensor auf dem Ziel-Host (idempotent — der Installer
 * lässt eine bereits laufende Installation unangetastet). Liefert ein
 * strukturiertes, redigiertes Ergebnis (nie rohe Fehler/Pfade nach außen).
 *
 * @param {object} params  { targetHost, sshUser?, sshPort?, monitorInterface, os? }
 * @param {object} deps    { runner } — SSH-Transport (injiziert)
 * @returns {Promise<{ok:boolean, host?:string, monitorInterface?:string, reason?:string}>}
 */
async function installIdsSensor(params = {}, { runner, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof runner !== 'function') {
    // Fail-closed: ohne Transport wird NICHT so getan, als sei etwas passiert.
    throw new DeployAdapterError('runner (SSH-Transport) erforderlich');
  }
  const v = validateParams(params);

  const env = {
    MONITOR_INTERFACE: v.monitorInterface,
    TARGET_OS:         v.os,
  };

  const res = await runner({
    host: v.targetHost, user: v.sshUser, port: v.sshPort,
    env, scriptId: 'install-ids-sensor', timeoutMs,
  });

  if (res && res.timedOut) {
    return { ok: false, host: v.targetHost, reason: 'timeout: Installation hat die Zeitgrenze überschritten' };
  }
  if (!res || res.code !== 0) {
    // Rohen stderr/stdout NICHT nach außen geben (kann Pfade des Ziels enthalten);
    // der Runner loggt ihn server-seitig.
    return { ok: false, host: v.targetHost, reason: `Installer beendet mit Code ${res ? res.code : 'unbekannt'}` };
  }
  return { ok: true, host: v.targetHost, monitorInterface: v.monitorInterface };
}

module.exports = { installIdsSensor, DeployAdapterError };
