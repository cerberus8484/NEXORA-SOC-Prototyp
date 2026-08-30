'use strict';

// crowdsecConnectionSettings — CrowdSec-LAPI-Verbindung (URL + MachineID + Passwort
// + tlsInsecure) aus der DB verwalten, ENV bleibt Fallback (DB > ENV). Passwort
// AES-256-GCM-verschlüsselt.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  CROWDSEC_CONNECTION_KEY,
  resolveCrowdsecConnection,
  saveCrowdsecConnection,
  maskedCrowdsecConnection,
} = require('../src/services/crowdsecConnectionSettings');

let repo;
const env = () => ({ CROWDSEC_LAPI_URL: 'https://env-lapi:8080', CROWDSEC_MACHINE_ID: 'env-machine', CROWDSEC_PASSWORD: 'env-pass' });

beforeEach(() => { repo = new InMemorySettingsRepository(); });

describe('resolveCrowdsecConnection', () => {
  test('ohne DB → ENV, source=env', async () => {
    const c = await resolveCrowdsecConnection(repo, env());
    expect(c).toMatchObject({ baseUrl: 'https://env-lapi:8080', machineId: 'env-machine', password: 'env-pass', source: 'env' });
  });

  test('DB gewinnt über ENV (Passwort entschlüsselt), source=db', async () => {
    await saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', password: 'db-pass', tlsInsecure: true });
    const c = await resolveCrowdsecConnection(repo, env());
    expect(c).toMatchObject({ baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', password: 'db-pass', tlsInsecure: true, source: 'db' });
  });

  test('weder DB noch ENV → leer, source=none', async () => {
    const c = await resolveCrowdsecConnection(repo, {});
    expect(c).toMatchObject({ baseUrl: '', machineId: '', password: '', source: 'none' });
  });
});

describe('saveCrowdsecConnection', () => {
  test('Passwort verschlüsselt (enc:v1:), nie Klartext', async () => {
    await saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', password: 'super-geheim' });
    const stored = await repo.get(CROWDSEC_CONNECTION_KEY);
    expect(isEncrypted(stored.password)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('super-geheim');
    expect(decryptSecret(stored.password)).toBe('super-geheim');
  });

  test('leeres Passwort behält das gespeicherte', async () => {
    await saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: 'm1', password: 'orig' });
    await saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: 'm2', password: '' });
    const c = await resolveCrowdsecConnection(repo, {});
    expect(c.machineId).toBe('m2');
    expect(c.password).toBe('orig');
  });

  test('leere URL löscht die Sektion → zurück auf ENV', async () => {
    await saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: 'm', password: 'p' });
    await saveCrowdsecConnection(repo, { baseUrl: '', machineId: '', password: '' });
    expect((await repo.get(CROWDSEC_CONNECTION_KEY)).baseUrl).toBeUndefined();
    expect((await resolveCrowdsecConnection(repo, env())).source).toBe('env');
  });

  test('Sektion ohne MachineID oder Passwort → CROWDSEC_INCOMPLETE, nichts gespeichert', async () => {
    await expect(saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: '', password: 'p' }))
      .rejects.toMatchObject({ code: 'CROWDSEC_INCOMPLETE' });
    await expect(saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: 'm', password: '' }))
      .rejects.toMatchObject({ code: 'CROWDSEC_INCOMPLETE' });
    expect(await repo.get(CROWDSEC_CONNECTION_KEY)).toBeNull();
  });
});

describe('maskedCrowdsecConnection', () => {
  test('gibt NIE das Passwort heraus — nur passwordSet + Quelle', async () => {
    await saveCrowdsecConnection(repo, { baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', password: 'geheim', tlsInsecure: true });
    const masked = await maskedCrowdsecConnection(repo, {});
    expect(masked).toEqual({ baseUrl: 'https://10.0.10.91:8080', machineId: 'nexora', tlsInsecure: true, passwordSet: true, source: 'db' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
  });
});
