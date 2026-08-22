'use strict';

// qdrantConnectionSettings — Qdrant-Verbindung (URL + optionaler API-Key) aus der
// DB verwalten, ENV bleibt Fallback (DB > ENV). API-Key AES-256-GCM-verschlüsselt.

const { InMemorySettingsRepository } = require('../src/repositories/InMemorySettingsRepository');
const { isEncrypted, decryptSecret } = require('../src/config/secretsCrypto');
const {
  QDRANT_CONNECTION_KEY,
  resolveQdrantConnection,
  saveQdrantConnection,
  maskedQdrantConnection,
} = require('../src/services/qdrantConnectionSettings');

let repo;
const envBackup = {};

beforeEach(() => {
  repo = new InMemorySettingsRepository();
  envBackup.url = process.env.QDRANT_URL;
  envBackup.key = process.env.QDRANT_API_KEY;
  process.env.QDRANT_URL = 'http://10.0.10.40:6333';
  process.env.QDRANT_API_KEY = 'env-key';
});
afterEach(() => {
  if (envBackup.url === undefined) delete process.env.QDRANT_URL; else process.env.QDRANT_URL = envBackup.url;
  if (envBackup.key === undefined) delete process.env.QDRANT_API_KEY; else process.env.QDRANT_API_KEY = envBackup.key;
});

describe('resolveQdrantConnection', () => {
  test('ohne DB → ENV, source=env', async () => {
    expect(await resolveQdrantConnection(repo)).toEqual({ url: 'http://10.0.10.40:6333', apiKey: 'env-key', source: 'env' });
  });

  test('DB gewinnt über ENV (Key entschlüsselt), source=db', async () => {
    await saveQdrantConnection(repo, { url: 'http://10.0.10.41:6333', apiKey: 'db-key' });
    expect(await resolveQdrantConnection(repo)).toEqual({ url: 'http://10.0.10.41:6333', apiKey: 'db-key', source: 'db' });
  });

  test('ohne ENV-URL → Default-URL, source=none (kein Key)', async () => {
    delete process.env.QDRANT_URL; delete process.env.QDRANT_API_KEY;
    const conn = await resolveQdrantConnection(repo);
    expect(conn.url).toBe('http://127.0.0.1:6333');
    expect(conn.apiKey).toBe('');
    expect(conn.source).toBe('none');
  });

  test('API-Key ist optional: DB-URL ohne Key erlaubt (Qdrant ohne Auth)', async () => {
    await saveQdrantConnection(repo, { url: 'http://10.0.10.41:6333', apiKey: '' });
    const conn = await resolveQdrantConnection(repo);
    expect(conn).toEqual({ url: 'http://10.0.10.41:6333', apiKey: '', source: 'db' });
  });
});

describe('saveQdrantConnection', () => {
  test('API-Key verschlüsselt (enc:v1:), nie Klartext', async () => {
    await saveQdrantConnection(repo, { url: 'http://10.0.10.41:6333', apiKey: 'super-geheim' });
    const stored = await repo.get(QDRANT_CONNECTION_KEY);
    expect(isEncrypted(stored.apiKey)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('super-geheim');
    expect(decryptSecret(stored.apiKey)).toBe('super-geheim');
  });

  test('leerer Key behält den gespeicherten', async () => {
    await saveQdrantConnection(repo, { url: 'http://10.0.10.41:6333', apiKey: 'orig' });
    await saveQdrantConnection(repo, { url: 'http://10.0.10.42:6333', apiKey: '' });
    const conn = await resolveQdrantConnection(repo);
    expect(conn.url).toBe('http://10.0.10.42:6333');
    expect(conn.apiKey).toBe('orig');
  });

  test('leere URL löscht die Sektion → zurück auf ENV', async () => {
    await saveQdrantConnection(repo, { url: 'http://10.0.10.41:6333', apiKey: 'k' });
    await saveQdrantConnection(repo, { url: '', apiKey: '' });
    expect((await repo.get(QDRANT_CONNECTION_KEY)).url).toBeUndefined();
    expect((await resolveQdrantConnection(repo)).source).toBe('env');
  });
});

describe('maskedQdrantConnection', () => {
  test('gibt NIE den Key heraus — nur apiKeySet + Quelle', async () => {
    await saveQdrantConnection(repo, { url: 'http://10.0.10.41:6333', apiKey: 'geheim' });
    const masked = await maskedQdrantConnection(repo);
    expect(masked).toEqual({ url: 'http://10.0.10.41:6333', apiKeySet: true, source: 'db' });
    expect(JSON.stringify(masked)).not.toContain('geheim');
  });
});
