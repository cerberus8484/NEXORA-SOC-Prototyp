'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Windows-Server First-Boot-Renderer (Cloudbase-Init).
//
// Rendert die validierten, SECRET-FREIEN Deploy-Params deterministisch in ein
// Cloudbase-Init `#ps1_sysnative`-User-Data-Skript (kein YAML → nur PowerShell,
// injektionsärmer). Setzt: Hostname · Netzwerk (static/DHCP) · OpenSSH aktivieren
// (damit der Update-Pfad, Slice 4, den Host erreicht) · optional Wazuh-Enrollment.
//
// SICHERHEIT (RCE-Fläche — der Renderer erzeugt Code, der als SYSTEM läuft):
//   - JEDER dynamische Wert wird ZUSÄTZLICH (Defense-in-Depth, zusätzlich zur Joi-
//     Validierung) gegen ein enges Muster geprüft und bei Verstoß hart abgelehnt;
//   - Werte werden als PowerShell-SINGLE-QUOTED-Literale eingebettet (kein $-Interp.,
//     ' wird verdoppelt) → kein Command-Injection über hostname/IP/manager;
//   - es wird NIE ein Secret gerendert (Passwort/Key kommen NICHT über den Spec).
//
// HINWEIS: Die konkreten PowerShell-Kommandos (Interface-Alias 'Ethernet', Wazuh-
// Installer-Pfad) sind gegen die Wazuh-/Cloudbase-Init-Doku modelliert, aber vor der
// Live-Schaltung auf einer echten Windows-Server-Golden-VM zu smoke-testen (Slice 6).
// ─────────────────────────────────────────────────────────────────────────

const HOST_RE  = /^[a-zA-Z0-9.-]{1,253}$/;
const NAME_RE  = /^[a-zA-Z0-9_.-]{1,64}$/;
const IPV4_RE  = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IFACE = 'Ethernet'; // Cloudbase-Init/Windows-Standard-Interface-Alias

function assertMatch(re, value, field) {
  const s = String(value == null ? '' : value);
  if (!re.test(s)) {
    const e = new Error(`windowsServerConfigRenderer: ungültiges Feld '${field}'`);
    e.retryable = false;
    throw e;
  }
  return s;
}
function assertInt(value, min, max, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    const e = new Error(`windowsServerConfigRenderer: ungültiges Feld '${field}'`);
    e.retryable = false;
    throw e;
  }
  return n;
}
// PowerShell single-quoted Literal: der Wert ist bereits gegen ein enges Muster
// geprüft (kein ' möglich), aber wir verdoppeln ' als Defense-in-Depth.
function psq(value) { return `'${String(value).replace(/'/g, "''")}'`; }

/**
 * @param {object} params validierte Deploy-Params (secret-frei)
 * @returns {string} Cloudbase-Init `#ps1_sysnative`-User-Data-Skript
 */
// OpenSSH-Public-Key-Zeile (ed25519): Typ + base64-Blob + Kommentar. Streng, damit
// nichts anderes als ein echter Public-Key in authorized_keys landet (kein Newline/Injektion).
const PUBKEY_RE = /^ssh-ed25519 [A-Za-z0-9+/]{1,200}=* [A-Za-z0-9_.@-]{1,64}$/;

/**
 * @param {object} params  validierte Deploy-Params (secret-frei)
 * @param {{ deployPublicKey?: string }} [opts]  optionaler Nexora-Deploy-Public-Key →
 *        wird in administrators_authorized_keys gelegt (Update-Zugang, Slice 6). PUBLIC,
 *        kein Secret. Validiert gegen PUBKEY_RE + single-quoted → keine Injektion.
 */
function renderWindowsUserData(params = {}, opts = {}) {
  const p = params || {};
  const hostname = assertMatch(HOST_RE, p.hostname, 'hostname');
  const dhcp = p.ipMode === 'dhcp';

  const L = [];
  L.push('#ps1_sysnative');
  L.push('# Nexora Deployment Center — First-Boot-Konfiguration (Cloudbase-Init). Generiert, secret-frei.');
  L.push("$ErrorActionPreference = 'Stop'");
  L.push('');
  L.push('# Hostname');
  L.push(`Rename-Computer -NewName ${psq(hostname)} -Force -ErrorAction SilentlyContinue`);
  L.push('');
  L.push('# Netzwerk');
  if (dhcp) {
    L.push(`Set-NetIPInterface -InterfaceAlias ${psq(IFACE)} -Dhcp Enabled`);
    L.push(`Set-DnsClientServerAddress -InterfaceAlias ${psq(IFACE)} -ResetServerAddresses`);
  } else {
    const staticIp = assertMatch(IPV4_RE, p.staticIp, 'staticIp');
    const cidr = assertInt(p.cidr, 0, 32, 'cidr');
    const gateway = assertMatch(IPV4_RE, p.gateway, 'gateway');
    const dns = (Array.isArray(p.dns) ? p.dns : []).map((d, i) => assertMatch(IPV4_RE, d, `dns[${i}]`));
    L.push(`New-NetIPAddress -InterfaceAlias ${psq(IFACE)} -IPAddress ${psq(staticIp)} -PrefixLength ${cidr} -DefaultGateway ${psq(gateway)}`);
    if (dns.length) {
      L.push(`Set-DnsClientServerAddress -InterfaceAlias ${psq(IFACE)} -ServerAddresses @(${dns.map(psq).join(', ')})`);
    }
  }
  L.push('');
  L.push('# OpenSSH-Server aktivieren (Ziel für den späteren Update-Pfad, Slice 4)');
  L.push("Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' -ErrorAction SilentlyContinue");
  L.push("Set-Service -Name sshd -StartupType Automatic -ErrorAction SilentlyContinue");
  L.push("Start-Service sshd -ErrorAction SilentlyContinue");

  // Nexora-Deploy-Public-Key in administrators_authorized_keys (Update-Zugang, Slice 6).
  // PUBLIC (kein Secret); streng validiert + single-quoted → keine authorized_keys-Injektion.
  if (opts && opts.deployPublicKey) {
    const pub = assertMatch(PUBKEY_RE, opts.deployPublicKey, 'deployPublicKey');
    L.push('');
    L.push('# Nexora-Deploy-Public-Key (Update-Zugang)');
    L.push("$akFile = 'C:\\ProgramData\\ssh\\administrators_authorized_keys'");
    L.push('New-Item -ItemType Directory -Force -Path (Split-Path $akFile) | Out-Null');
    L.push(`Add-Content -Path $akFile -Value ${psq(pub)}`);
    // administrators_authorized_keys braucht enge ACLs (nur Administrators + SYSTEM).
    L.push("icacls $akFile /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null");
  }

  // Optionaler Wazuh-Agent-Enroll (nur wenn wazuhManager gesetzt). Der Installer selbst
  // (deploy/install-wazuh-agent.ps1, Authenticode-geprüft) muss im Golden-Template liegen
  // oder per Config-Media beigelegt werden (Template-Prep, Slice 6). Manager/Name kommen
  // aus den Deploy-Params — NICHT aus dem Template.
  if (p.wazuhManager != null && p.wazuhManager !== '') {
    const manager = assertMatch(HOST_RE, p.wazuhManager, 'wazuhManager');
    const agentName = assertMatch(NAME_RE, (p.agentName != null && p.agentName !== '') ? p.agentName : hostname, 'agentName');
    L.push('');
    L.push('# Wazuh-Agent enrollen (Manager + Name aus den Deploy-Params)');
    L.push(`$env:WAZUH_MANAGER = ${psq(manager)}`);
    L.push(`$env:WAZUH_AGENT_NAME = ${psq(agentName)}`);
    L.push("& 'C:\\Nexora\\install-wazuh-agent.ps1'");
  }
  L.push('');
  return L.join('\n');
}

module.exports = { renderWindowsUserData, psq, IFACE };
