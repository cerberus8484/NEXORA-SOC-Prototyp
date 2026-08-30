'use strict';

// ─────────────────────────────────────────────────────────────────────────
// nodeUpdateService — gated, auditierte Update-Action für einen verwalteten
// Windows- ODER Linux-Node („updatebar", Slice 4/8). Löst den Node aus der
// Provisioning-Registry auf und führt das OS-passende allowlisted Update-Skript
// (update-wazuh-agent-windows via ssh-powershell bzw. update-wazuh-agent via
// ssh-bash) über den injizierten Runner aus.
//
// FAIL-CLOSED (mehrschichtig):
//   - Arm-Flag (NODE_UPDATE_ENABLED, default aus) — sonst deny;
//   - frische Reauth (verifyDeployReauth, an actor.id gebunden) — sonst deny;
//   - Ziel-Host kommt AUS DER REGISTRY (node.ip), NIE aus Nutzereingabe;
//   - fester scriptId (Allowlist im Runner) → fester Skript-Pfad;
//   - der SSH-Runner ist INJIZIERT (Default fail-safe: wirft) — die Live-Auth
//     (Platform-Deploy-Keypair + gepinnter Host-Key) ist Slice-6-Wiring.
// Jede Aktion/Ablehnung wird auditiert (redigiert, kein Roh-Fehler/Secret).
// ─────────────────────────────────────────────────────────────────────────

const UPDATE_SCRIPT_ID = 'update-wazuh-agent-windows'; // Windows (Rückwärtskompat-Export)
const DEFAULT_TIMEOUT_MS = 300000; // msiexec-/apt-Upgrade kann dauern
const VERSION_RE = /^[0-9][0-9A-Za-z.-]{0,31}$/; // Ziel-Version, injektionssicher (gilt für beide OS-Zweige)

// OS → (Update-Skript-Allowlist-Key im sshExecRunner, SSH-User). Klassifikation
// case-insensitiv per Substring, damit sowohl deployte Nodes (os 'windows'/'linux',
// DeployService) als auch enrollte (os aus `uname -s` = 'Linux') greifen. Der Runner
// erzwingt zusätzlich die scriptId-Allowlist. Unbekanntes OS ⇒ null ⇒ E_UNSUPPORTED.
function updateTargetForOs(os) {
  const o = String(os || '').toLowerCase();
  if (o.includes('windows')) return { scriptId: 'update-wazuh-agent-windows', user: 'Administrator' };
  if (o.includes('linux')) return { scriptId: 'update-wazuh-agent', user: 'root' };
  return null;
}

class NodeUpdateError extends Error {
  constructor(message, code = 'NODE_UPDATE_ERROR') { super(message); this.name = 'NodeUpdateError'; this.code = code; }
}

// Default-Runner: kein Zustellkanal konfiguriert → wirft (kein stiller Erfolg).
function defaultRunnerFactory() {
  throw new NodeUpdateError('Update-Runner nicht konfiguriert — kein Zustellkanal (Platform-Deploy-Key/Host-Key, Slice 6).', 'E_NO_CHANNEL');
}

class NodeUpdateService {
  constructor({ provisioningRepo, authService, runnerFactory, isUpdateEnabled, audit, hostKeyScanner } = {}) {
    if (!provisioningRepo) throw new Error('NodeUpdateService: provisioningRepo erforderlich');
    if (!authService || typeof authService.verifyDeployReauth !== 'function') throw new Error('NodeUpdateService: authService (verifyDeployReauth) erforderlich');
    this._repo = provisioningRepo;
    this._auth = authService;
    this._runnerFactory = typeof runnerFactory === 'function' ? runnerFactory : defaultRunnerFactory;
    this._isUpdateEnabled = typeof isUpdateEnabled === 'function' ? isUpdateEnabled : () => process.env.NODE_UPDATE_ENABLED === 'true';
    this._audit = typeof audit === 'function' ? audit : async () => {};
    this._hostKeyScanner = typeof hostKeyScanner === 'function' ? hostKeyScanner : null; // Option 2 (Arm-Confirm)
  }

  /**
   * Option 2 (Arm-Confirm / Fallback): scannt den Host-Key eines verwalteten Nodes und
   * pinnt ihn — der Prep-Schritt, um den Node update-fähig zu machen (z. B. wenn Option-1-
   * Auto-Capture beim Deploy scheiterte oder der Node nicht über Nexora deployt wurde).
   * Admin + frische Reauth (fail-closed); der Host kommt AUS DER REGISTRY, nie aus Eingabe.
   * KEIN Arm-Flag nötig (das ist die Vorbereitung, nicht die Ausführung). Gibt den
   * erfassten Fingerprint zurück, damit der Admin ihn out-of-band verifizieren kann.
   */
  async captureHostKey(nodeId, { actor, reauthToken } = {}) {
    const reauth = await this._auth.verifyDeployReauth(reauthToken, actor && actor.id);
    if (!reauth || !reauth.ok) {
      await this._safeAudit('node.hostkey.denied', { actor, nodeId, reason: 'reauth' });
      throw new NodeUpdateError('Frische Reauth erforderlich (X-Reauth-Token).', 'E_REAUTH');
    }
    if (!this._hostKeyScanner) throw new NodeUpdateError('Host-Key-Scanner nicht konfiguriert.', 'E_NO_CHANNEL');
    const node = await this._repo.getNode(nodeId);
    if (!node) throw new NodeUpdateError(`Node '${nodeId}' nicht gefunden`, 'E_NOT_FOUND');
    if (!node.ip) throw new NodeUpdateError(`Node '${nodeId}' hat keine IP in der Registry`, 'E_NO_HOST');

    let pin;
    try {
      pin = await this._hostKeyScanner({ host: node.ip });
    } catch (e) {
      await this._safeAudit('node.hostkey.failed', { actor, nodeId, host: node.ip, reason: 'scan_failed' });
      throw new NodeUpdateError('Host-Key-Scan fehlgeschlagen.', 'E_SCAN');
    }
    await this._repo.updateNode(node.id, { hostKeyPin: pin });
    await this._safeAudit('node.hostkey.captured', { actor, nodeId, host: node.ip });
    return { nodeId, host: node.ip, fingerprint: pin };
  }

  async updateNode(nodeId, { actor, reauthToken, agentVersion } = {}) {
    // 1. Arm-Flag (fail-closed)
    if (this._isUpdateEnabled() !== true) {
      await this._safeAudit('node.update.denied', { actor, nodeId, reason: 'not_armed' });
      throw new NodeUpdateError('Node-Update ist nicht scharfgeschaltet (NODE_UPDATE_ENABLED).', 'E_NOT_ARMED');
    }
    // 2. Frische Reauth (fail-closed, an actor.id gebunden)
    const reauth = await this._auth.verifyDeployReauth(reauthToken, actor && actor.id);
    if (!reauth || !reauth.ok) {
      await this._safeAudit('node.update.denied', { actor, nodeId, reason: 'reauth' });
      throw new NodeUpdateError('Frische Reauth erforderlich (X-Reauth-Token).', 'E_REAUTH');
    }
    // 3. Optionale Ziel-Version validieren (Defense-in-Depth; der Runner prüft ENV zusätzlich)
    if (agentVersion != null && agentVersion !== '' && !VERSION_RE.test(String(agentVersion))) {
      throw new NodeUpdateError('ungültige agentVersion', 'E_BAD_VERSION');
    }
    // 4. Node aus der Registry (Host NIE aus Nutzereingabe)
    const node = await this._repo.getNode(nodeId);
    if (!node) throw new NodeUpdateError(`Node '${nodeId}' nicht gefunden`, 'E_NOT_FOUND');
    const target = updateTargetForOs(node.os);
    if (!target) throw new NodeUpdateError(`Node '${nodeId}' hat kein unterstütztes OS (Windows/Linux)`, 'E_UNSUPPORTED');
    if (!node.ip) throw new NodeUpdateError(`Node '${nodeId}' hat keine IP in der Registry`, 'E_NO_HOST');

    // 5. Runner bauen (injiziert; fail-safe Default; kann async sein — echter Runner
    //    resolved den verschlüsselten Deploy-Private-Key erst hier) + OS-passendes
    //    Update-Skript ausführen (scriptId + SSH-User aus der OS-Klassifikation).
    const runner = await this._runnerFactory(node); // kann fail-closed werfen
    const env = {};
    if (agentVersion) env.WAZUH_AGENT_VERSION = String(agentVersion);

    let result;
    try {
      result = await runner({ host: node.ip, user: target.user, port: 22, env, scriptId: target.scriptId, timeoutMs: DEFAULT_TIMEOUT_MS });
    } catch (e) {
      await this._safeAudit('node.update.failed', { actor, nodeId, host: node.ip, reason: 'ssh_error' });
      throw new NodeUpdateError('Update-Ausführung fehlgeschlagen.', 'E_SSH');
    }
    if (result && result.timedOut) {
      await this._safeAudit('node.update.failed', { actor, nodeId, host: node.ip, reason: 'timeout' });
      throw new NodeUpdateError('Zeitüberschreitung beim Update.', 'E_TIMEOUT');
    }
    if (!result || result.code !== 0) {
      await this._safeAudit('node.update.failed', { actor, nodeId, host: node.ip, reason: 'nonzero' });
      throw new NodeUpdateError('Update fehlgeschlagen.', 'E_UPDATE_FAILED');
    }
    await this._safeAudit('node.update.ran', { actor, nodeId, host: node.ip });
    return { ok: true, nodeId, host: node.ip };
  }

  async _safeAudit(type, detail) {
    try { await this._audit(type, detail); } catch { /* Audit-Fehler darf die Aktion nicht kippen */ }
  }
}

module.exports = { NodeUpdateService, NodeUpdateError, UPDATE_SCRIPT_ID };
