'use strict';

// servicenowConnectionSettings — ServiceNow-Outbound-Verbindung (URL + Benutzer +
// Passwort + Table) aus der DB verwalten, ENV bleibt Fallback (DB > ENV). Passwort
// AES-256-GCM-verschlüsselt.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  SERVICENOW_CONNECTION_KEY,
  resolveServicenowConnection,
  saveServicenowConnection,
  maskedServicenowConnection,
} = require('../src/services/servicenowConnectionSettings');

let repo;
const env = () => ({ SERVICENOW_BASE_URL: 'https://env.service-now.com', SERVICENOW_USERNAME: 'env-user', SERVICENOW_PASSWORD: 'env-pass' });

beforeEach(() => { repo = new InMemorySettingsRepository(); });

describe('resolveServicenowConnection', () => {
  test('ohne DB → ENV, source=env, Table-Default incident', async () => {
    const c = await resolveServicenowConnection(repo, env());
    expect(c).toMatchObject({ baseUrl: 'https://env.service-now.com', username: 'env-user', password: 'env-pass', table: 'incident', source: 'env' });
  });

  test('DB gewinnt über ENV (Passwort entschlüsselt), source=db', async () => {
    await saveServicenowConnection(repo, { baseUrl: 'https://acme.service-now.com', username: 'soc', password: 'db-pass', table: 'sn_si_incident' });
    const c = await resolveServicenowConnection(repo, env());
    expect(c).toMatchObject({ baseUrl: 'https://acme.service-now.com', username: 'soc', password: 'db-pass', table: 'sn_si_incident', source: 'db' });
  });

  test('weder DB noch ENV → leer, source=none', async () => {
    const c = await resolveServicenowConnection(repo, {});
    expect(c).toMatchObject({ baseUrl: '', username: '', password: '', source: 'none' });
  });
});

describe('saveServicenowConnection', () => {
  test('Passwort verschlüsselt (enc:v1:), nie Klartext', async () => {
    await saveServicenowConnection(repo, { baseUrl: 'https://acme.service-now.com', username: 'soc', password: 'super-geheim' });
    const stored = await repo.get(SERVICENOW_CONNECTION_KEY);
    expect(isEncrypted(stored.password)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('super-geheim');
    expect(decryptSecret(stored.password)).toBe('super-geheim');
  });

  test('leeres Passwort behält das gespeicherte', async () => {
    await saveServicenowConnection(repo, { baseUrl: 'https://acme.service-now.com', username: 'u1', password: 'orig' });
    await saveServicenowConnection(repo, { baseUrl: 'https://acme.service-now.com', username: 'u2', password: '' });
    const c = await resolveServicenowConnection(repo, {});
    expect(c.username).toBe('u2');
    expect(c.password).toBe('orig');
  });

  test('leere URL löscht die Verbindung → zurück auf ENV', async () => {
    await saveServicenowConnection(repo, { baseUrl: 'https://acme.service-now.com', username: 'u', password: 'p' });
    await saveServicenowConnection(repo, { baseUrl: '', username: '', password: '' });
    expect((await repo.get(SERVICENOW_CONNECTION_KEY)).baseUrl).toBeUndefined();
    expect((await resolveServicenowConnection(repo, env())).source).toBe('env');
  });

  test('Verbindung ohne Benutzer oder Passwort → SERVICENOW_INCOMPLETE, nichts gespeichert', async () => {
    await expect(saveServicenowConnection(repo, { baseUrl: 'https://acme.service-now.com', username: '', password: 'p' }))
      .rejects.toMatchObject({ code: 'SERVICENOW_INCOMPLETE' });
    await expect(saveServicenowConnection(repo, { baseUrl: 'https://acme.service-now.com', username: 'u', password: '' }))
      .rejects.toMatchObject({ code: 'SERVICENOW_INCOMPLETE' });
    expect(await repo.get(SERVICENOW_CONNECTION_KEY)).toBeNull();
  });
});

describe('maskedServicenowConnection', () => {
  test('gibt NIE das Passwort heraus — nur passwordSet + Quelle', async () => {
    await saveServicenowConnection(repo, { baseUrl: 'https://acme.service-now.com', username: 'soc', password: 'geheim', table: 'incident' });
    const masked = await maskedServicenowConnection(repo, {});
    expect(masked).toEqual({ baseUrl: 'https://acme.service-now.com', username: 'soc', table: 'incident', passwordSet: true, source: 'db' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
  });
});
