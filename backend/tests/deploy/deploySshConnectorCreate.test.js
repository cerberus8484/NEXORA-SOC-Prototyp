'use strict';

// Slice 2c-a: SSH-Connector anlegen (Route-Schema + Service-Persistenz + Postgres-Insert).
// privateKey ist write-only + verschlüsselt at-rest; Public-View leakt nie Key-Material.

const crypto = require('crypto');
const { createConnectorSchema } = require('../../src/domain/validation/deploySchema');
const { DeployService } = require('../../src/deploy/DeployService');
const { InMemoryDeployRepository } = require('../../src/deploy/InMemoryDeployRepository');
const { InMemoryProxmoxConnector } = require('../../src/deploy/connectors/InMemoryProxmoxConnector');
const { PostgresDeployRepository } = require('../../src/deploy/PostgresDeployRepository');
const { SshDeployConnector } = require('../../src/deploy/sshDeployConnectorDomain');
const { makeSshRunner } = require('../../src/deploy/connectors/sshRunnerFactory');

const PIN = crypto.createHash('sha256').update(Buffer.from('k')).digest('hex');
const PRIV = '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETMATERIAL\n-----END OPENSSH PRIVATE KEY-----';
const sshInput = { type: 'ssh', name: 'web01', host: '10.0.10.90', sshUser: 'deploy', sshPort: 22, privateKey: PRIV, passphrase: 'pw', hostKeyPin: PIN };

// createConnector verlangt jetzt frische Reauth (wie Apply) → Happy-Path-Stub akzeptiert.
const stubAuth = { verifyDeployReauth: () => ({ ok: true }) };
const connectorFactory = () => new InMemoryProxmoxConnector({ templates: ['9000'], bridges: ['vmbr1'], nextVmid: 1 });

describe('createConnectorSchema — ssh + proxmox', () => {
  test('gültiger ssh-Connector wird akzeptiert', () => {
    expect(createConnectorSchema.validate(sshInput).error).toBeUndefined();
  });
  test('ssh ohne privateKey / ohne hostKeyPin / mit ungültigem Pin wird abgelehnt', () => {
    expect(createConnectorSchema.validate({ ...sshInput, privateKey: undefined }).error).toBeTruthy();
    expect(createConnectorSchema.validate({ ...sshInput, hostKeyPin: undefined }).error).toBeTruthy();
    expect(createConnectorSchema.validate({ ...sshInput, hostKeyPin: 'zzz' }).error).toBeTruthy();
  });
  test('proxmox verlangt weiterhin apiToken + targetNode (IPv4-Host)', () => {
    expect(createConnectorSchema.validate({ type: 'proxmox', name: 'x', host: '10.0.0.1' }).error).toBeTruthy();
    expect(createConnectorSchema.validate({ type: 'proxmox', name: 'x', host: '10.0.0.1', apiToken: 't', targetNode: 'n' }).error).toBeUndefined();
  });
  test('typ-fremde Felder werden abgelehnt (kein Secret-Schmuggel im falschen Typ)', () => {
    // ssh mit proxmox-apiToken → abgelehnt
    expect(createConnectorSchema.validate({ ...sshInput, apiToken: 'geheim', targetNode: 'pve' }).error).toBeTruthy();
    // proxmox mit ssh-privateKey → abgelehnt
    expect(createConnectorSchema.validate({ type: 'proxmox', name: 'x', host: '10.0.0.1', apiToken: 't', targetNode: 'n', privateKey: 'x' }).error).toBeTruthy();
  });
});

describe('DeployService.createConnector — ssh (In-Memory)', () => {
  function makeSvc() {
    const repo = new InMemoryDeployRepository();
    return { repo, svc: new DeployService({ repo, authService: stubAuth, connectorFactory }) };
  }

  test('persistiert verschlüsselt; Public-View OHNE Key-Material', async () => {
    const { repo, svc } = makeSvc();
    const view = await svc.createConnector(sshInput, { label: 'alice', id: 'u1' }, 'reauth-ok');
    expect(view).toMatchObject({ type: 'ssh', host: '10.0.10.90', sshUser: 'deploy', hostKeyPin: PIN });
    expect(view).not.toHaveProperty('privateKeyEnc');
    expect(view).not.toHaveProperty('passphraseEnc');
    expect(JSON.stringify(view)).not.toContain('SECRETMATERIAL');

    // Gespeicherte Zeile trägt die verschlüsselten Felder (fürs Repo/den Runner).
    const row = await repo.getConnector(view.id);
    expect(row.privateKeyEnc).toMatch(/^enc:v1:/);
    expect(row.hostKeyPin).toBe(PIN);
  });

  test('aus der gespeicherten Zeile lässt sich ein Runner bauen (Kette schließt sich)', async () => {
    const { repo, svc } = makeSvc();
    const view = await svc.createConnector(sshInput, { label: 'alice', id: 'u1' }, 'reauth-ok');
    const row = await repo.getConnector(view.id);
    expect(typeof makeSshRunner(row)).toBe('function'); // baut createSshExecRunner (verbindet noch nicht)
  });

  test('Audit-Eintrag ohne Secret', async () => {
    const { repo, svc } = makeSvc();
    const view = await svc.createConnector(sshInput, { label: 'alice', id: 'u1' }, 'reauth-ok');
    const audit = await repo.listDeployAudit({ connectorId: view.id });
    expect(audit.some((a) => a.type === 'deploy.connector.created')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('SECRETMATERIAL');
  });

  test('ohne gültige Reauth → E_REAUTH, nichts persistiert, Denied-Audit ohne Secret', async () => {
    const repo = new InMemoryDeployRepository();
    const denyAuth = { verifyDeployReauth: () => ({ ok: false }) };
    const svc = new DeployService({ repo, authService: denyAuth, connectorFactory });

    await expect(svc.createConnector(sshInput, { label: 'alice', id: 'u1' }, 'bad'))
      .rejects.toMatchObject({ code: 'E_REAUTH', statusCode: 401 });

    expect(await repo.listConnectors()).toHaveLength(0); // fail-closed: kein Secret gespeichert
    const audit = await repo.listDeployAudit();
    expect(audit.some((a) => a.type === 'deploy.connector.reauth_denied')).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('SECRETMATERIAL');
  });
});

describe('PostgresDeployRepository.createConnector — ssh-Insert-Form', () => {
  test('INSERT trifft ssh-Spalten (private_key_enc/host_key_pin), NICHT api_token_enc', async () => {
    const calls = [];
    const fakeQuery = async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{
        id: params[0], type: params[1], name: params[2], host: params[3], ssh_user: params[4], ssh_port: params[5],
        private_key_enc: params[6], passphrase_enc: params[7], host_key_pin: params[8], status: params[9], created_by: params[10],
      }] };
    };
    const repo = new PostgresDeployRepository({ queryFn: fakeQuery });
    const conn = SshDeployConnector.create({ name: 'web01', host: '10.0.10.90', privateKey: PRIV, hostKeyPin: PIN });

    const out = await repo.createConnector(conn.toRow());
    expect(calls[0].sql).toContain('private_key_enc');
    expect(calls[0].sql).toContain('host_key_pin');
    expect(calls[0].sql).not.toContain('api_token_enc');
    expect(calls[0].params).toContain(conn.hostKeyPin);
    expect(calls[0].params).toContain(conn.privateKeyEnc);
    expect(out.privateKeyEnc).toMatch(/^enc:v1:/);
    expect(out.hostKeyPin).toBe(PIN);
  });
});
