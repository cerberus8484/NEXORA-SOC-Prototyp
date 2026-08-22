'use strict';

// otrsConnectionSettings — OTRS/Znuny-Outbound-Verbindung (URL + Benutzer + Passwort
// + Queue/WebService/Operation) aus der DB verwalten, ENV bleibt Fallback (DB > ENV).
// Passwort AES-256-GCM-verschlüsselt.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  OTRS_CONNECTION_KEY,
  resolveOtrsConnection,
  saveOtrsConnection,
  maskedOtrsConnection,
} = require('../src/services/otrsConnectionSettings');

let repo;
const env = () => ({ OTRS_BASE_URL: 'https://env-otrs.local', OTRS_USERNAME: 'env-agent', OTRS_PASSWORD: 'env-pass' });

beforeEach(() => { repo = new InMemorySettingsRepository(); });

describe('resolveOtrsConnection', () => {
  test('ohne DB → ENV, source=env, Defaults für Queue/WebService/Operation', async () => {
    const c = await resolveOtrsConnection(repo, env());
    expect(c).toMatchObject({
      baseUrl: 'https://env-otrs.local', username: 'env-agent', password: 'env-pass',
      queue: 'Security', webService: 'GenericTicketConnectorREST', operation: 'TicketCreate', source: 'env',
    });
  });

  test('DB gewinnt über ENV (Passwort entschlüsselt), source=db', async () => {
    await saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: 'soc', password: 'db-pass', queue: 'SOC', webService: 'WS', operation: 'TicketCreate' });
    const c = await resolveOtrsConnection(repo, env());
    expect(c).toMatchObject({ baseUrl: 'https://otrs.acme.local', username: 'soc', password: 'db-pass', queue: 'SOC', webService: 'WS', source: 'db' });
  });

  test('weder DB noch ENV → leer, source=none', async () => {
    const c = await resolveOtrsConnection(repo, {});
    expect(c).toMatchObject({ baseUrl: '', username: '', password: '', source: 'none' });
  });
});

describe('saveOtrsConnection', () => {
  test('Passwort verschlüsselt (enc:v1:), nie Klartext', async () => {
    await saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: 'soc', password: 'super-geheim' });
    const stored = await repo.get(OTRS_CONNECTION_KEY);
    expect(isEncrypted(stored.password)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('super-geheim');
    expect(decryptSecret(stored.password)).toBe('super-geheim');
  });

  test('leeres Passwort behält das gespeicherte', async () => {
    await saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: 'u1', password: 'orig' });
    await saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: 'u2', password: '' });
    const c = await resolveOtrsConnection(repo, {});
    expect(c.username).toBe('u2');
    expect(c.password).toBe('orig');
  });

  test('Defaults gesetzt, wenn Queue/WebService/Operation leer', async () => {
    await saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: 'soc', password: 'p' });
    const c = await resolveOtrsConnection(repo, {});
    expect(c).toMatchObject({ queue: 'Security', webService: 'GenericTicketConnectorREST', operation: 'TicketCreate' });
  });

  test('leere URL löscht die Verbindung → zurück auf ENV', async () => {
    await saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: 'u', password: 'p' });
    await saveOtrsConnection(repo, { baseUrl: '', username: '', password: '' });
    expect((await repo.get(OTRS_CONNECTION_KEY)).baseUrl).toBeUndefined();
    expect((await resolveOtrsConnection(repo, env())).source).toBe('env');
  });

  test('Verbindung ohne Benutzer oder Passwort → OTRS_INCOMPLETE, nichts gespeichert', async () => {
    await expect(saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: '', password: 'p' }))
      .rejects.toMatchObject({ code: 'OTRS_INCOMPLETE' });
    await expect(saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: 'u', password: '' }))
      .rejects.toMatchObject({ code: 'OTRS_INCOMPLETE' });
    expect(await repo.get(OTRS_CONNECTION_KEY)).toBeNull();
  });
});

describe('maskedOtrsConnection', () => {
  test('gibt NIE das Passwort heraus — nur passwordSet + Quelle', async () => {
    await saveOtrsConnection(repo, { baseUrl: 'https://otrs.acme.local', username: 'soc', password: 'geheim', queue: 'SOC' });
    const masked = await maskedOtrsConnection(repo, {});
    expect(masked).toEqual({
      baseUrl: 'https://otrs.acme.local', username: 'soc', queue: 'SOC',
      webService: 'GenericTicketConnectorREST', operation: 'TicketCreate', passwordSet: true, source: 'db',
    });
    expect(JSON.stringify(masked)).not.toContain('geheim');
  });
});
