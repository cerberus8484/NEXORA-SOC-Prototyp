'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Deployment Center — SSH-Runner-Factory (agent-install).
//
// Baut aus einem gespeicherten, verschlüsselten SSH-Connector den SSH-Runner für den
// ssh-systemd-Adapter. Der Private-Key wird NUR hier transient entschlüsselt und direkt
// als In-Memory-Wert an createSshExecRunner gegeben (nie auf Platte, nie geloggt). Der
// Host-Key-Pin (SHA-256) des Connectors wird gepinnt; allowedHosts = genau der Connector-
// Host → ein Spec, das einen anderen Host anfährt, wird vom Runner abgelehnt (fail-closed).
// ─────────────────────────────────────────────────────────────────────────────

const { AppError } = require('../../errors/AppError');
const { SshDeployConnector } = require('../sshDeployConnectorDomain');
const { createSshExecRunner } = require('../adapters/sshExecRunner');

function appError(message, status, code) {
  const e = new AppError(message, status, code); e.status = status; return e;
}

/**
 * @param {object} connectorRow  gespeicherter SSH-Connector (type='ssh', privateKeyEnc …)
 * @param {{ createClient?: Function }} [deps]  Test-Injektion des ssh2-Clients
 * @returns {Function} runner({host,user,port,env,scriptId,timeoutMs}) → Promise<{code,timedOut}>
 */
function makeSshRunner(connectorRow, { createClient } = {}) {
  if (!connectorRow || connectorRow.type !== 'ssh') {
    throw appError('SSH-Connector erwartet (type=ssh) — Linux-Client-Deploy fail-closed', 400, 'BAD_REQUEST');
  }
  const c = new SshDeployConnector(connectorRow);
  const passphrase = c.getPassphrase();
  const opts = {
    privateKey: c.getPrivateKey(),          // transient entschlüsselt; createSshExecRunner wirft, wenn leer
    hostKeys: { [c.host]: c.hostKeyPin },    // Host-Key-Pinning (fail-closed)
    allowedHosts: [c.host],                  // genau dieser Host ist autorisiert
  };
  if (passphrase) opts.passphrase = passphrase;
  if (createClient) opts.createClient = createClient;
  return createSshExecRunner(opts);
}

module.exports = { makeSshRunner };
