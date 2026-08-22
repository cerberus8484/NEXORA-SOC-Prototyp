'use strict';

// Verdrahtet den nodeUpdateService (Slice 4 „updatebar") mit dem realen Provisioning-
// Repo, AuthService (Reauth), Audit-Log und dem ECHTEN Runner (Slice 6f): der Runner
// wird aus dem verschlüsselten Platform-Deploy-Private-Key (6d) + node.ip + gepinntem
// host_key_pin (6a–c) gebaut. Der Arm-Flag liest NODE_UPDATE_ENABLED zur Laufzeit
// (default AUS) — die Route ist also erreichbar, führt aber nur bei scharfem Flag +
// vorhandenem Keypair + gepinntem Host-Key wirklich aus (mehrschichtig fail-closed).
//
// Repo-Wahl folgt der Provisioning-Konvention (createProvisioningRepository je Consumer):
// in Prod (DB_ENABLED) teilen alle dieselbe Postgres-DB, InMemory ist Dev/Test-lokal.

const { createProvisioningRepository } = require('../repositories/provisioningRepositoryFactory');
const { authService } = require('./AuthService');
const { auditService } = require('./AuditService');
const { NodeUpdateService, NodeUpdateError } = require('./nodeUpdateService');
const { scanHostKeyPin } = require('../deploy/adapters/sshHostKeyScan');
const { createSshExecRunner } = require('../deploy/adapters/sshExecRunner');
const { resolveDeployPrivateKey } = require('./deployKeypairSettings');

let _singleton = null;

// Baut den echten Update-Runner für einen Node (Slice 6f). FAIL-CLOSED:
//   - kein Platform-Deploy-Keypair → E_NO_CHANNEL (POST /deploy/keypair/generate);
//   - kein gepinnter Host-Key → E_NO_HOSTKEY (erst hostkey/capture bzw. Auto-Capture);
//   - keine IP → E_NO_HOST.
// Der Private-Key wird NUR hier transient entschlüsselt (nie geloggt/zurückgegeben);
// der Runner verifiziert den Server-Key gegen den gepinnten host_key_pin (kein TOFU).
// Deps injizierbar für Tests.
async function buildDeployUpdateRunner(node, { resolvePrivateKey = resolveDeployPrivateKey, createRunner = createSshExecRunner } = {}) {
  const privateKey = await resolvePrivateKey();
  if (!privateKey) throw new NodeUpdateError('Platform-Deploy-Keypair nicht konfiguriert (POST /deploy/keypair/generate).', 'E_NO_CHANNEL');
  if (!node || !node.hostKeyPin) throw new NodeUpdateError('Kein gepinnter Host-Key — zuerst erfassen (hostkey/capture bzw. Auto-Capture).', 'E_NO_HOSTKEY');
  if (!node.ip) throw new NodeUpdateError('Node hat keine IP in der Registry.', 'E_NO_HOST');
  return createRunner({ privateKey, hostKeys: { [node.ip]: node.hostKeyPin }, allowedHosts: [node.ip] });
}

function getNodeUpdateService() {
  if (_singleton) return _singleton;
  _singleton = new NodeUpdateService({
    provisioningRepo: createProvisioningRepository(),
    authService,
    isUpdateEnabled: () => process.env.NODE_UPDATE_ENABLED === 'true',
    // Option 2 (Arm-Confirm): echter Host-Key-Scanner für captureHostKey.
    hostKeyScanner: ({ host }) => scanHostKeyPin({ host, timeoutMs: 5000 }),
    // Slice 6f: echter Runner aus Deploy-Private-Key + node.ip + gepinntem host_key_pin.
    runnerFactory: (node) => buildDeployUpdateRunner(node),
    audit: async (event, detail = {}) => {
      await auditService.write({
        actorUserId: (detail.actor && detail.actor.id) || null,
        actorLabel: (detail.actor && detail.actor.label) || 'unknown',
        action: 'NODE_UPDATE',
        targetType: 'node',
        targetId: detail.nodeId || '',
        // Nur sichere Felder — kein Roh-Fehler/Secret (der Service liefert ohnehin nur Kategorien).
        metadata: { event, host: detail.host, reason: detail.reason },
      }).catch(() => { /* Audit-Fehler darf die Aktion nicht kippen */ });
    },
  });
  return _singleton;
}

module.exports = { getNodeUpdateService, buildDeployUpdateRunner };
