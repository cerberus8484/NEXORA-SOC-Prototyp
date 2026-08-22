'use strict';

// makeSshRunner (Slice 2b-2): baut aus einem verschlüsselten SSH-Connector einen
// SSH-Runner (createSshExecRunner) — In-Memory-Key transient entschlüsselt, Host-Key
// gepinnt, allowedHosts=[connector.host]. Getestet mit injiziertem Fake-ssh2-Client.

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { SshDeployConnector } = require('../../src/deploy/sshDeployConnectorDomain');
const { makeSshRunner } = require('../../src/deploy/connectors/sshRunnerFactory');

const SERVER_KEY = Buffer.from('the-server-host-key');
const PIN = crypto.createHash('sha256').update(SERVER_KEY).digest('hex');
const PRIV = '-----BEGIN OPENSSH PRIVATE KEY-----\nMATERIAL\n-----END OPENSSH PRIVATE KEY-----';
const HOST = '10.0.10.90';

function connectorRow(over = {}) {
  return SshDeployConnector.create({
    name: 'web01', host: HOST, sshUser: 'deploy', sshPort: 22,
    privateKey: PRIV, passphrase: 'pw', hostKeyPin: PIN, ...over,
  }).toRow();
}

// Fake-ssh2-Client (Erfolg), zeichnet connect-Config auf.
function fakeFactory(state) {
  return () => {
    const client = new EventEmitter();
    client.connect = (cfg) => {
      state.cfg = cfg;
      setImmediate(() => cfg.hostVerifier(SERVER_KEY, (ok) => (ok ? client.emit('ready') : client.emit('error', new Error('pin')))));
    };
    client.exec = (cmd, cb) => {
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.write = () => {}; stream.end = () => {};
      cb(null, stream);
      setImmediate(() => stream.emit('close', 0));
    };
    client.end = () => {};
    return client;
  };
}

describe('makeSshRunner', () => {
  test('baut einen Runner; Erfolg → {code:0}; nutzt entschlüsselten In-Memory-Key + Host-Key-Pin', async () => {
    const state = {};
    const runner = makeSshRunner(connectorRow(), { createClient: fakeFactory(state) });
    const res = await runner({ host: HOST, user: 'deploy', port: 22, env: { WAZUH_MANAGER: '10.0.10.77' }, scriptId: 'install-wazuh-agent', timeoutMs: 2000 });
    expect(res).toMatchObject({ code: 0 });
    expect(state.cfg.privateKey).toBe(PRIV);       // transient entschlüsselt, In-Memory
    expect(state.cfg.passphrase).toBe('pw');
    expect(typeof state.cfg.hostVerifier).toBe('function');
  });

  test('Nicht-SSH-Connector (falscher type) → fail-closed (wirft)', () => {
    expect(() => makeSshRunner({ type: 'proxmox', host: HOST })).toThrow();
    expect(() => makeSshRunner(null)).toThrow();
  });

  test('Ziel-Host ≠ connector.host → vom Runner abgelehnt (allowedHosts=[host])', async () => {
    const runner = makeSshRunner(connectorRow(), { createClient: fakeFactory({}) });
    await expect(runner({ host: '10.0.10.99', user: 'deploy', port: 22, env: {}, scriptId: 'install-wazuh-agent' }))
      .rejects.toThrow();
  });

  test('Connector ohne Key-Material (privateKeyEnc leer) → fail-closed (wirft beim Bau)', () => {
    const row = connectorRow();
    row.privateKeyEnc = '';
    expect(() => makeSshRunner(row, { createClient: fakeFactory({}) })).toThrow();
  });
});
