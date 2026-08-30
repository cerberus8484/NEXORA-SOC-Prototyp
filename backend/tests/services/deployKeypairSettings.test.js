'use strict';

// Slice 6d: Platform-Deploy-Keypair. Nexora generiert ein ed25519-Keypair, speichert
// den Private-Key VERSCHLÜSSELT, gibt nur den Public-Key/Fingerprint her. Getestet:
// Generierung + verschlüsselte Ablage, maskierte Sicht (nie Private), transientes
// Entschlüsseln, Rotation, und der abgeleitete Public-Key ist ein GÜLTIGER OpenSSH-Key.

const { utils: sshUtils } = require('ssh2');
const {
  getDeployKeypair, generateDeployKeypair, resolveDeployPrivateKey, resolveDeployPublicKey,
} = require('../../src/services/deployKeypairSettings');
const { isEncrypted } = require('../../src/config/secretsCrypto');

function fakeRepo() {
  const store = new Map();
  return { store, get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } };
}

describe('deployKeypairSettings', () => {
  test('nicht gesetzt → { isSet: false }', async () => {
    expect(await getDeployKeypair(fakeRepo())).toEqual({ isSet: false });
    expect(await resolveDeployPrivateKey(fakeRepo())).toBeNull();
    expect(await resolveDeployPublicKey(fakeRepo())).toBeNull();
  });

  test('generate: Private-Key VERSCHLÜSSELT abgelegt; Rückgabe maskiert (kein Private)', async () => {
    const repo = fakeRepo();
    const res = await generateDeployKeypair(repo);
    expect(res).toMatchObject({ isSet: true });
    expect(res.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+=* nexora-deploy$/);
    expect(res.fingerprint).toMatch(/^SHA256:/);
    expect(res).not.toHaveProperty('privateKeyEnc');
    expect(JSON.stringify(res)).not.toMatch(/PRIVATE KEY/);
    // Gespeicherte Zeile trägt den VERSCHLÜSSELTEN Private-Key.
    expect(isEncrypted(repo.store.get('deploy_keypair').privateKeyEnc)).toBe(true);
  });

  test('getDeployKeypair maskiert — NIE der Private-Key', async () => {
    const repo = fakeRepo();
    await generateDeployKeypair(repo);
    const masked = await getDeployKeypair(repo);
    expect(masked).toMatchObject({ isSet: true });
    expect(masked).not.toHaveProperty('privateKeyEnc');
    expect(masked.publicKey).toMatch(/^ssh-ed25519 /);
    expect(JSON.stringify(masked)).not.toMatch(/PRIVATE KEY/);
  });

  test('resolveDeployPrivateKey entschlüsselt transient (PEM); resolveDeployPublicKey liefert den Public-Key', async () => {
    const repo = fakeRepo();
    const { publicKey } = await generateDeployKeypair(repo);
    const priv = await resolveDeployPrivateKey(repo);
    expect(priv).toMatch(/-----BEGIN PRIVATE KEY-----/);
    expect(await resolveDeployPublicKey(repo)).toBe(publicKey);
  });

  test('der abgeleitete Public-Key ist ein GÜLTIGER OpenSSH-ed25519-Key (ssh2-Round-Trip)', async () => {
    const repo = fakeRepo();
    const { publicKey } = await generateDeployKeypair(repo);
    const parsed = sshUtils.parseKey(publicKey);
    expect(parsed).not.toBeInstanceOf(Error);
    expect(parsed.type).toBe('ssh-ed25519');
  });

  test('rotate: zweite Generierung liefert ein ANDERES Keypair', async () => {
    const repo = fakeRepo();
    const a = await generateDeployKeypair(repo);
    const b = await generateDeployKeypair(repo);
    expect(b.publicKey).not.toBe(a.publicKey);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  test('fail-closed: unverschlüsselt gespeicherter Private-Key → resolve wirft', async () => {
    const repo = fakeRepo();
    repo.store.set('deploy_keypair', { privateKeyEnc: 'PLAINTEXT-NICHT-ENC', publicKey: 'ssh-ed25519 x' });
    await expect(resolveDeployPrivateKey(repo)).rejects.toThrow(/nicht verschlüsselt|fail-closed/);
  });
});
