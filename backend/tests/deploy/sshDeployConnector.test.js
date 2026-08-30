'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// SSH-Deploy-Connector (Slice 2b-2): hält die SSH-Zugangsdaten für EINEN Ziel-Host
// (agent-install / Brownfield). privateKey + passphrase werden AES-256-GCM at-rest
// verschlüsselt und erscheinen NIE im toJSON/Row-Public/Log. hostKeyPin ist ein
// SHA-256-Fingerprint des Server-Host-Keys (öffentlich, kein Secret).
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { SshDeployConnector } = require('../../src/deploy/sshDeployConnectorDomain');
const { isEncrypted } = require('../../src/config/secretsCrypto');

const PIN = crypto.createHash('sha256').update(Buffer.from('server-host-key')).digest('hex');
const PRIV = '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET-KEY-MATERIAL\n-----END OPENSSH PRIVATE KEY-----';

const baseInput = (over = {}) => ({
  name: 'web01-ssh', host: '10.0.10.90', sshUser: 'deploy', sshPort: 22,
  privateKey: PRIV, passphrase: 'kp', hostKeyPin: PIN, ...over,
});

describe('SshDeployConnector.create — Validierung', () => {
  test('gültige Eingabe → verschlüsselt privateKey/passphrase, setzt Defaults', () => {
    const c = SshDeployConnector.create(baseInput());
    expect(c.host).toBe('10.0.10.90');
    expect(c.sshUser).toBe('deploy');
    expect(c.sshPort).toBe(22);
    expect(c.hostKeyPin).toBe(PIN);
    expect(isEncrypted(c.privateKeyEnc)).toBe(true);
    expect(isEncrypted(c.passphraseEnc)).toBe(true);
  });

  test('sshUser default root; leere passphrase → passphraseEnc leer', () => {
    const c = SshDeployConnector.create(baseInput({ sshUser: undefined, passphrase: '' }));
    expect(c.sshUser).toBe('root');
    expect(c.passphraseEnc).toBe('');
  });

  test('Windows-Konto (Administrator) wird akzeptiert; Injektion weiter abgelehnt', () => {
    expect(SshDeployConnector.create(baseInput({ sshUser: 'Administrator' })).sshUser).toBe('Administrator');
    expect(() => SshDeployConnector.create(baseInput({ sshUser: 'ad min' }))).toThrow();
    expect(() => SshDeployConnector.create(baseInput({ sshUser: 'a;b' }))).toThrow();
  });

  test('Injektion im host / ungültiger User / Port / Pin wird abgelehnt', () => {
    expect(() => SshDeployConnector.create(baseInput({ host: '10.0.0.1; rm -rf /' }))).toThrow();
    expect(() => SshDeployConnector.create(baseInput({ sshUser: 'ro ot' }))).toThrow();
    expect(() => SshDeployConnector.create(baseInput({ sshPort: 70000 }))).toThrow();
    expect(() => SshDeployConnector.create(baseInput({ hostKeyPin: 'nicht-hex' }))).toThrow();
    expect(() => SshDeployConnector.create(baseInput({ privateKey: '' }))).toThrow();
  });
});

describe('SshDeployConnector — kein Secret-Leak', () => {
  test('toJSON enthält host/user/pin, aber NIE Key-Material/Enc', () => {
    const c = SshDeployConnector.create(baseInput());
    const dump = JSON.stringify(c.toJSON());
    expect(dump).not.toContain('SECRET-KEY-MATERIAL');
    expect(dump).not.toContain(c.privateKeyEnc);
    expect(dump).not.toContain('kp');
    expect(c.toJSON()).not.toHaveProperty('privateKeyEnc');
    expect(c.toJSON()).not.toHaveProperty('passphraseEnc');
    expect(c.toJSON()).toMatchObject({ type: 'ssh', host: '10.0.10.90', sshUser: 'deploy', hostKeyPin: PIN });
  });

  test('toRow persistiert die verschlüsselten Felder (für Repo)', () => {
    const c = SshDeployConnector.create(baseInput());
    const row = c.toRow();
    expect(row.privateKeyEnc).toBe(c.privateKeyEnc);
    expect(row.passphraseEnc).toBe(c.passphraseEnc);
    expect(row.type).toBe('ssh');
  });
});

describe('SshDeployConnector — transiente Entschlüsselung', () => {
  test('getPrivateKey liefert Klartext zurück (nur transient)', () => {
    const c = SshDeployConnector.create(baseInput());
    const round = new SshDeployConnector(c.toRow());
    expect(round.getPrivateKey()).toBe(PRIV);
    expect(round.getPassphrase()).toBe('kp');
  });

  test('leere passphrase → getPassphrase null', () => {
    const c = SshDeployConnector.create(baseInput({ passphrase: '' }));
    expect(new SshDeployConnector(c.toRow()).getPassphrase()).toBeNull();
  });
});
