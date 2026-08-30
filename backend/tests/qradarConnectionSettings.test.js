'use strict';

// qradarConnectionSettings — QRadar-Verbindung (Base-URL + API-Token) aus der DB
// verwalten, ENV bleibt Fallback (DB > ENV). Token AES-256-GCM-verschlüsselt.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  QRADAR_CONNECTION_KEY,
  resolveQradarConnection,
  saveQradarConnection,
  maskedQradarConnection,
} = require('../src/services/qradarConnectionSettings');

let repo;
const envBackup = {};

beforeEach(() => {
  repo = new InMemorySettingsRepository();
  envBackup.url = process.env.QRADAR_BASE_URL;
  envBackup.token = process.env.QRADAR_TOKEN;
  process.env.QRADAR_BASE_URL = 'https://env-qradar';
  process.env.QRADAR_TOKEN = 'env-token';
});

afterEach(() => {
  if (envBackup.url === undefined) delete process.env.QRADAR_BASE_URL; else process.env.QRADAR_BASE_URL = envBackup.url;
  if (envBackup.token === undefined) delete process.env.QRADAR_TOKEN; else process.env.QRADAR_TOKEN = envBackup.token;
});

describe('resolveQradarConnection', () => {
  test('ohne DB → ENV, source=env', async () => {
    expect(await resolveQradarConnection(repo)).toEqual({ baseUrl: 'https://env-qradar', token: 'env-token', source: 'env' });
  });

  test('DB gewinnt über ENV (Token entschlüsselt), source=db', async () => {
    await saveQradarConnection(repo, { baseUrl: 'https://10.0.10.60', token: 'db-token' });
    expect(await resolveQradarConnection(repo)).toEqual({ baseUrl: 'https://10.0.10.60', token: 'db-token', source: 'db' });
  });

  test('weder DB noch ENV → leer, source=none', async () => {
    delete process.env.QRADAR_BASE_URL; delete process.env.QRADAR_TOKEN;
    expect(await resolveQradarConnection(repo)).toEqual({ baseUrl: '', token: '', source: 'none' });
  });
});

describe('saveQradarConnection', () => {
  test('Token liegt verschlüsselt in der DB (enc:v1:), nie Klartext', async () => {
    await saveQradarConnection(repo, { baseUrl: 'https://10.0.10.60', token: 'super-geheim' });
    const stored = await repo.get(QRADAR_CONNECTION_KEY);
    expect(isEncrypted(stored.token)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('super-geheim');
    expect(decryptSecret(stored.token)).toBe('super-geheim');
  });

  test('leerer Token behält den gespeicherten', async () => {
    await saveQradarConnection(repo, { baseUrl: 'https://10.0.10.60', token: 'orig' });
    await saveQradarConnection(repo, { baseUrl: 'https://10.0.10.61', token: '' });
    const conn = await resolveQradarConnection(repo);
    expect(conn.baseUrl).toBe('https://10.0.10.61');
    expect(conn.token).toBe('orig');
  });

  test('leere Base-URL löscht die Sektion → zurück auf ENV', async () => {
    await saveQradarConnection(repo, { baseUrl: 'https://10.0.10.60', token: 't' });
    await saveQradarConnection(repo, { baseUrl: '', token: '' });
    const stored = await repo.get(QRADAR_CONNECTION_KEY);
    expect(stored.baseUrl).toBeUndefined();
    expect((await resolveQradarConnection(repo)).source).toBe('env');
  });

  test('Sektion ohne Token (kein gespeicherter) → WQRADAR_INCOMPLETE, nichts gespeichert', async () => {
    await expect(saveQradarConnection(repo, { baseUrl: 'https://10.0.10.60', token: '' }))
      .rejects.toMatchObject({ code: 'QRADAR_INCOMPLETE' });
    expect(await repo.get(QRADAR_CONNECTION_KEY)).toBeNull();
  });
});

describe('maskedQradarConnection', () => {
  test('gibt NIE den Token heraus — nur tokenSet + Quelle', async () => {
    await saveQradarConnection(repo, { baseUrl: 'https://10.0.10.60', token: 'geheim' });
    const masked = await maskedQradarConnection(repo);
    expect(masked).toEqual({ baseUrl: 'https://10.0.10.60', tokenSet: true, source: 'db' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
  });

  test('nur ENV → tokenSet aus ENV, source=env', async () => {
    const masked = await maskedQradarConnection(repo);
    expect(masked).toEqual({ baseUrl: 'https://env-qradar', tokenSet: true, source: 'env' });
  });
});
