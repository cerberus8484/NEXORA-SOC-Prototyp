'use strict';

// imapConnectionSettings — IMAP-Postfach-Verbindung (Host + Port + User + Passwort
// + TLS) aus der DB verwalten, ENV bleibt Fallback (DB > ENV). Passwort
// AES-256-GCM-verschlüsselt.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  IMAP_CONNECTION_KEY,
  resolveImapConnection,
  saveImapConnection,
  maskedImapConnection,
} = require('../src/services/imapConnectionSettings');

let repo;
const env = () => ({ IMAP_HOST: 'mail.env', IMAP_USER: 'env@x', IMAP_PASSWORD: 'env-pass' });

beforeEach(() => { repo = new InMemorySettingsRepository(); });

describe('resolveImapConnection', () => {
  test('ohne DB → ENV, Port/secure-Defaults, source=env', async () => {
    const c = await resolveImapConnection(repo, env());
    expect(c).toMatchObject({ host: 'mail.env', port: 993, user: 'env@x', password: 'env-pass', secure: true, source: 'env' });
  });

  test('IMAP_TLS=false + IMAP_PORT aus ENV übernommen', async () => {
    const c = await resolveImapConnection(repo, { ...env(), IMAP_TLS: 'false', IMAP_PORT: '143' });
    expect(c).toMatchObject({ port: 143, secure: false });
  });

  test('DB gewinnt über ENV (Passwort entschlüsselt), source=db', async () => {
    await saveImapConnection(repo, { host: '10.0.10.85', port: 143, user: 'soc@nexora', password: 'db-pass', secure: false });
    const c = await resolveImapConnection(repo, env());
    expect(c).toMatchObject({ host: '10.0.10.85', port: 143, user: 'soc@nexora', password: 'db-pass', secure: false, source: 'db' });
  });

  test('weder DB noch ENV → leer, source=none', async () => {
    const c = await resolveImapConnection(repo, {});
    expect(c).toMatchObject({ host: '', user: '', password: '', source: 'none' });
  });
});

describe('saveImapConnection', () => {
  test('Passwort verschlüsselt (enc:v1:), nie Klartext', async () => {
    await saveImapConnection(repo, { host: '10.0.10.85', user: 'soc@nexora', password: 'super-geheim' });
    const stored = await repo.get(IMAP_CONNECTION_KEY);
    expect(isEncrypted(stored.password)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('super-geheim');
    expect(decryptSecret(stored.password)).toBe('super-geheim');
  });

  test('leeres Passwort behält das gespeicherte', async () => {
    await saveImapConnection(repo, { host: '10.0.10.85', user: 'u1', password: 'orig' });
    await saveImapConnection(repo, { host: '10.0.10.85', user: 'u2', password: '' });
    const c = await resolveImapConnection(repo, {});
    expect(c.user).toBe('u2');
    expect(c.password).toBe('orig');
  });

  test('secure default true; Port-Default 993 ohne Angabe', async () => {
    await saveImapConnection(repo, { host: '10.0.10.85', user: 'u', password: 'p' });
    const c = await resolveImapConnection(repo, {});
    expect(c).toMatchObject({ port: 993, secure: true });
  });

  test('leerer Host löscht die Sektion → zurück auf ENV', async () => {
    await saveImapConnection(repo, { host: '10.0.10.85', user: 'u', password: 'p' });
    await saveImapConnection(repo, { host: '', user: '', password: '' });
    expect((await repo.get(IMAP_CONNECTION_KEY)).host).toBeUndefined();
    expect((await resolveImapConnection(repo, env())).source).toBe('env');
  });

  test('Sektion ohne User oder Passwort → IMAP_INCOMPLETE, nichts gespeichert', async () => {
    await expect(saveImapConnection(repo, { host: '10.0.10.85', user: '', password: 'p' }))
      .rejects.toMatchObject({ code: 'IMAP_INCOMPLETE' });
    await expect(saveImapConnection(repo, { host: '10.0.10.85', user: 'u', password: '' }))
      .rejects.toMatchObject({ code: 'IMAP_INCOMPLETE' });
    expect(await repo.get(IMAP_CONNECTION_KEY)).toBeNull();
  });
});

describe('maskedImapConnection', () => {
  test('gibt NIE das Passwort heraus — nur passwordSet + Quelle', async () => {
    await saveImapConnection(repo, { host: '10.0.10.85', port: 143, user: 'soc@nexora', password: 'geheim', secure: false });
    const masked = await maskedImapConnection(repo, {});
    expect(masked).toEqual({ host: '10.0.10.85', port: 143, user: 'soc@nexora', secure: false, passwordSet: true, source: 'db' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
  });
});
