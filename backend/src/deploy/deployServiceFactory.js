'use strict';

// Verdrahtet den DeployService mit dem realen Repo, AuthService, der Connector-
// Factory und den config-Appliern. Der Kill-Switch liest DEPLOY_ENABLED zur
// Laufzeit (default AUS) — ohne Flag ist Apply hart geblockt.

const config = require('../config');
const { getDeployRepository } = require('./deployRepositoryFactory');
const { authService } = require('../services/AuthService');
const { makeProxmoxConnector } = require('./connectors/proxmoxConnectorFactory');
const { makeSshRunner } = require('./connectors/sshRunnerFactory');
const { makeOpnsenseConfigApplier } = require('./appliers/opnsenseConfigApplier');
const { windowsServerConfigApplier } = require('./appliers/windowsServerConfigApplier');
const { resolveDeliverFromEnv } = require('./appliers/deliverChannelFactory');
const { buildOpnsenseConfigMedia } = require('./appliers/opnsenseConfigMedia');
const { DeployOrchestrator } = require('./DeployOrchestrator');
const { DeployService } = require('./DeployService');
const { nodeEnrollmentService } = require('../services/NodeEnrollmentService');
const { scanHostKeyPin } = require('./adapters/sshHostKeyScan');
const deployArmStore = require('../services/deployArmStore');
const { computeDeployPreflight } = require('./deployPreflight');

const STATUS_POLL_DELAY_MS = 2000;

let _singleton = null;

// ── Zwei-Schlüssel-Modell ────────────────────────────────────────────────────
// Boden (Kommissionierung, out-of-band): env DEPLOY_ENABLED. Kann ein App-Kompromiss
// NICHT umlegen. Toggle (Betrieb): deployArmStore in der DB, per UI mit Step-up+Audit.
// EFFEKTIV scharf nur, wenn BEIDE an sind.
function isDeployFloorEnabled() { return process.env.DEPLOY_ENABLED === 'true'; }

/** Async Effektiv-Zustand: env-Boden UND DB-Arm-Toggle. */
async function isDeployEnabled() {
  return isDeployFloorEnabled() && isEncKeyDedicated() && (await deployArmStore.isArmed());
}

// Boot-Bedingung „Enc-Key dediziert": SETTINGS_ENC_KEY ist eigenständiges
// Schlüsselmaterial (≥32) und darf NICHT mit JWT_SECRET identisch sein. Sonst wären
// Auth-Signierung und die Verschlüsselung gespeicherter Connector-Secrets nicht
// getrennt. Bestehende Secrets vor einer Schlüsseltrennung kontrolliert migrieren.
function isEncKeyDedicated() {
  const settingsKey = process.env.SETTINGS_ENC_KEY || '';
  const jwtSecret = process.env.JWT_SECRET || '';
  return settingsKey.length >= 32 && settingsKey !== jwtSecret;
}

/** Rohe Fakten fürs Preflight-Panel einsammeln (env + DB-Arm-Zustand). */
async function getDeployPreflight() {
  const armed = await deployArmStore.isArmed();
  return computeDeployPreflight({
    floorEnabled: isDeployFloorEnabled(),
    armed,
    hypervisorAllowlistSet: String(process.env.DEPLOY_HYPERVISOR_ALLOWED_HOSTS || '').trim() !== '',
    encKeyDedicated: isEncKeyDedicated(),
  });
}

// config-Applier je Modul-configApplierId. Der deliver-Kanal wird über
// DEPLOY_DELIVER_CHANNEL gewählt (Default fail-safe: ohne konfigurierten
// Gast-Zustellkanal wirft der Applier → der Deploy rollt kontrolliert zurück
// statt eine unkonfigurierte VM als „deployed" zu melden). Der mediaBuilder
// verpackt die gerenderte config.xml fürs First-Boot-Import-Volume. Siehe Runbook.
function buildConfigAppliers() {
  const deliver = resolveDeliverFromEnv({ mediaBuilder: { build: buildOpnsenseConfigMedia } });
  return {
    'opnsense-config-import': makeOpnsenseConfigApplier({ deliver }),
    // windows-server (Slice 2): Applier mit FAIL-SAFE Default-Deliver — der echte
    // Cloudbase-Init-Config-Drive-Kanal folgt Slice 6. Bis dahin rollt ein Apply
    // kontrolliert zurück statt eine unkonfigurierte VM als „deployed" zu melden.
    'windows-server-config': windowsServerConfigApplier,
  };
}

function createDeployService() {
  const repo = getDeployRepository();
  // Status-Poll-Budget aus der Operator-Config ableiten (VM-Boot kann langsam sein):
  // Gesamt-Timeout / fester Delay → Anzahl der Versuche.
  const timeoutMs = (config.deploy && config.deploy.statusPollTimeoutMs) || 120000;
  const statusPollAttempts = Math.max(1, Math.ceil(timeoutMs / STATUS_POLL_DELAY_MS));
  const orchestrator = new DeployOrchestrator({ repo, statusPollAttempts, statusPollDelayMs: STATUS_POLL_DELAY_MS });
  return new DeployService({
    repo,
    authService,
    connectorFactory: (connectorDomain, opts) => makeProxmoxConnector(connectorDomain, opts),
    // agent-install (Linux-Client): baut den SSH-Runner aus dem verschlüsselten
    // SSH-Connector. Ohne passenden Connector wirft es (fail-closed). Bleibt durch
    // DEPLOY_ENABLED + Reauth + Vier-Augen ohnehin inert bis zum Scharfschalten.
    sshRunnerFactory: (connectorRow) => makeSshRunner(connectorRow),
    configAppliers: buildConfigAppliers(),
    isDeployEnabled,
    orchestrator,
    // Slice 3: erfolgreich deployte Server-VM als persistenten Managed-Node registrieren.
    nodeRegistrar: (data) => nodeEnrollmentService.registerInstalledNode(data),
    // Slice 6c (Option 1): best-effort Host-Key-Auto-Capture nach dem Deploy (kurzer
    // Timeout; scheitert er, greift Option 2 Arm-Confirm). Nie deploy-kippend.
    hostKeyScanner: ({ host }) => scanHostKeyPin({ host, timeoutMs: 4000 }),
  });
}

function getDeployService() {
  if (!_singleton) _singleton = createDeployService();
  return _singleton;
}

module.exports = {
  createDeployService, getDeployService,
  isDeployEnabled, isDeployFloorEnabled, isEncKeyDedicated, getDeployPreflight,
};
