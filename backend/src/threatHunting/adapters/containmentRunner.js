'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// ADR-042 Slice 3a — Containment-Runner (Bridge: ResponseAction → sshExecRunner).
//
// HuntService.executeResponseAction ruft `responseRunnerFactory(action)` und danach
// `runner({ action })`. Dieser Adapter baut aus einer genehmigten, umkehrbaren
// Containment-Aktion den ECHTEN SSH-Runner:
//   action.targetHost → enrollter managed Node (Registry) → gepinnter host_key_pin
//   action.kind       → fester Skript-Allowlist-Key (isolate-host / release-isolation)
//
// SICHERHEIT (das ist die RCE/Netz-Fläche — bewusst mehrschichtig fail-closed):
//   - Nur enrollte, host-key-gepinnte Nodes (kein TOFU) und nur Linux (nftables).
//   - Kern-Invariante MGMT-PRESERVATION: Isolation OHNE bekannte Mgmt-CIDR wird
//     verweigert (Selbst-Aussperr-Schutz) — sonst wäre die spätere Freigabe nicht
//     mehr zustellbar. Die CIDR geht als validierte ENV an das Skript, das den
//     Mgmt-Kanal explizit offen hält.
//   - Jede fehlende Vorbedingung wirft VOR jedem Kanalaufbau; die Aktion bleibt
//     dadurch 'approved' (retriable), nicht 'executing' (kein stiller Teil-Erfolg).
// Der Kill-Switch (HUNT_RESPONSE_REAL_EXEC_ENABLED) und die frische Reauth liegen
// im Service davor — dieser Adapter ist ohne beides nie erreichbar.
// ─────────────────────────────────────────────────────────────────────────────

const config = require('../../config');
const { createSshExecRunner } = require('../../deploy/adapters/sshExecRunner');
const { resolveDeployPrivateKey } = require('../../services/deployKeypairSettings');

const CONTAINMENT_TIMEOUT_MS = 60000; // nftables-Anwendung ist schnell — 60s Deckel

// M-1 (Security-Review): nur AKTUELL verwaltete Nodes sind Containment-Ziele. 'retired'
// (decommissioned) + 'pending' (noch kein Host-Key) werden ausgeschlossen — sonst könnte
// ein stale-gepinnter Alt-Record das Targeting/Ambiguitäts-Signal verwässern (DHCP: die IP
// sitzt evtl. längst an einem anderen Host). NODE_STATUS = pending/enrolled/active/stale/retired.
const CONTAINABLE_STATUS = new Set(['enrolled', 'active', 'stale']);

// (OS, kind) → fester scriptId-Allowlist-Key (in sshExecRunner). Nur umkehrbare Aktionen.
// Linux = nftables (bash), Windows = Windows-Firewall (powershell). Nie aus Nutzereingabe.
const SCRIPT_BY_OS_KIND = Object.freeze({
  linux:   Object.freeze({ isolate_host: 'isolate-host',         release_isolation: 'release-isolation' }),
  windows: Object.freeze({ isolate_host: 'isolate-host-windows', release_isolation: 'release-isolation-windows' }),
});

function containmentError(message, code) {
  return Object.assign(new Error(message), { status: 503, code });
}

// Gültiger SSH-User aus der Registry (kein durchgereichter Fremd-/Injection-Wert). Erlaubt
// POSIX- + Windows-Konten inkl. DOMAIN\user und user@domain. Ungültig → OS-Default.
const SSH_USER_RE = /^[A-Za-z0-9._@\\-]{1,64}$/;

// Konsistent zu nodeUpdateService.updateTargetForOs: „windows" als Teilstring (nicht bloß
// „win", das würde z.B. einen Linux-Host „winston" fälschlich als Windows einstufen).
function isWindowsOs(os) { return String(os || '').toLowerCase().includes('windows'); }

function defaultGetMgmt() {
  return {
    cidr: config.huntResponse?.mgmtCidr || null,
    port: config.huntResponse?.mgmtSshPort || '22',
  };
}

/**
 * Baut die responseRunnerFactory für ADR-042 Stufe 3 (echter, gated Containment-Exec).
 * Rückgabe passt in HuntService: factory(action) → runner({ action }) → { code, timedOut }.
 *
 * @param {object} deps
 * @param {{ findNodesByIp(ip:string):Promise<object[]> }} deps.provisioningRepo
 * @param {() => Promise<string|Buffer|null>} [deps.resolvePrivateKey]
 * @param {(opts:object) => Function} [deps.createRunner]  createSshExecRunner (Test-Injektion)
 * @param {() => {cidr:(string|null), port:string}} [deps.getMgmt]
 * @returns {(action:object) => Promise<Function>}
 */
function buildContainmentRunner({
  provisioningRepo,
  resolvePrivateKey = resolveDeployPrivateKey,
  createRunner = createSshExecRunner,
  getMgmt = defaultGetMgmt,
} = {}) {
  if (!provisioningRepo || typeof provisioningRepo.findNodesByIp !== 'function') {
    throw new Error('buildContainmentRunner: provisioningRepo mit findNodesByIp ist Pflicht');
  }

  return async function responseRunnerFactory(action) {
    const kind = action && action.kind;
    // 1. Nur umkehrbare Containment-Aktionen (Defense-in-Depth; Service gated ebenfalls).
    if (kind !== 'isolate_host' && kind !== 'release_isolation') {
      throw containmentError(`Containment-Runner unterstützt nur isolate_host/release_isolation, nicht ${kind}.`, 'E_UNSUPPORTED_KIND');
    }

    // 2. Ziel-Host → enrollter managed Node (Registry). Fail-closed bei Ambiguität:
    //    in DHCP-Umgebungen kann eine IP mehreren Records gehören → NIE still einen wählen
    //    (sonst isoliert man evtl. den falschen Host). Host-key-gepinnt (kein TOFU).
    const allNodes = await provisioningRepo.findNodesByIp(action.targetHost);
    // M-1: decommissionierte/pending Records ausfiltern, BEVOR Leere/Ambiguität geprüft wird.
    const nodes = (allNodes || []).filter((n) => CONTAINABLE_STATUS.has(String(n && n.status)));
    if (nodes.length === 0) throw containmentError('Ziel-Host ist kein aktiver managed Node (Registry).', 'E_NO_NODE');
    if (nodes.length > 1)   throw containmentError('Mehrere aktive Nodes teilen sich diese IP — mehrdeutig, Isolation verweigert (Registry-Hygiene).', 'E_AMBIGUOUS_NODE');
    const node = nodes[0];
    if (!node.ip)         throw containmentError('Node hat keine IP in der Registry.', 'E_NO_HOST');
    if (!node.hostKeyPin) throw containmentError('Kein gepinnter Host-Key — Verbindung abgelehnt (kein TOFU).', 'E_NO_HOSTKEY');
    // OS-Routing: Linux (nftables/bash, user root) bzw. Windows (Windows-Firewall/powershell,
    // user Administrator) → fester Allowlist-Key + passender SSH-User. Nie aus Nutzereingabe.
    const targetOs = isWindowsOs(node.os) ? 'windows' : 'linux';
    const scriptId = SCRIPT_BY_OS_KIND[targetOs][kind];
    // SSH-User: aus der Registry (validiert), sonst OS-Default. Nie ein ungeprüfter Wert.
    const defaultUser = targetOs === 'windows' ? 'Administrator' : 'root';
    const sshUser = (node.sshUser && SSH_USER_RE.test(String(node.sshUser))) ? String(node.sshUser) : defaultUser;

    // 3. MGMT-PRESERVATION: Isolation ohne bekannte Mgmt-CIDR verweigern (Selbst-Aussperr-Schutz).
    //    Freigabe braucht sie nicht — sie stellt Konnektivität ohnehin wieder her.
    const mgmt = getMgmt() || {};
    let env = {};
    if (kind === 'isolate_host') {
      if (!mgmt.cidr) {
        throw containmentError('Isolation ohne Mgmt-Preservation-CIDR verweigert (HUNT_RESPONSE_MGMT_CIDR).', 'E_NO_MGMT_PRESERVE');
      }
      env = { NEXORA_MGMT_CIDR: String(mgmt.cidr), NEXORA_MGMT_SSH_PORT: String(mgmt.port || '22') };
    }

    // 4. Deploy-Private-Key transient auflösen (nie geloggt/zurückgegeben).
    const privateKey = await resolvePrivateKey();
    if (!privateKey) {
      throw containmentError('Platform-Deploy-Keypair nicht konfiguriert (POST /deploy/keypair/generate).', 'E_NO_CHANNEL');
    }

    // 5. SSH-Runner mit gepinntem Host-Key + strikter Allowlist auf genau diese Node-IP.
    const sshRunner = createRunner({
      privateKey,
      hostKeys:     { [node.ip]: node.hostKeyPin },
      allowedHosts: [node.ip],
    });

    return async function runner() {
      return sshRunner({ host: node.ip, user: sshUser, port: 22, env, scriptId, timeoutMs: CONTAINMENT_TIMEOUT_MS });
    };
  };
}

module.exports = { buildContainmentRunner };
