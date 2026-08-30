'use strict';

// Layer 2: modulweite Qdrant-Runtime-Config (DB>ENV via Applier gesetzt). Auch
// bereits erzeugte Client-Instanzen greifen sie live (Getter, kein Ctor-Snapshot).
// Präzedenz: explizite Ctor-Args (Tests) > Runtime (DB) > ENV > Default.

const { QdrantClient, setQdrantRuntimeConfig } = require('../../src/rag/QdrantClient');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

const envBackup = {};
beforeEach(() => {
  envBackup.url = process.env.QDRANT_URL;
  envBackup.key = process.env.QDRANT_API_KEY;
  delete process.env.QDRANT_URL;
  delete process.env.QDRANT_API_KEY;
  setQdrantRuntimeConfig({ url: '', apiKey: '' }); // sauberer Start
});
afterEach(() => {
  setQdrantRuntimeConfig({ url: '', apiKey: '' });
  if (envBackup.url === undefined) delete process.env.QDRANT_URL; else process.env.QDRANT_URL = envBackup.url;
  if (envBackup.key === undefined) delete process.env.QDRANT_API_KEY; else process.env.QDRANT_API_KEY = envBackup.key;
});

describe('Qdrant-Runtime-Config', () => {
  test('Runtime gewinnt über ENV; bereits erzeugte Instanz greift sie live', async () => {
    process.env.QDRANT_URL = 'http://env:6333';
    const http = new InMemoryHttpClient();
    http.mockUrl('/collections/x/points/search', 200, { result: [] });
    const c = new QdrantClient({ http });   // vor reconfigure erzeugt

    setQdrantRuntimeConfig({ url: 'http://db:6333/', apiKey: 'db-key' });
    await c.search('x', [0.1], 3);

    const req = http.getRequests().find((r) => r.url.includes('/points/search'));
    expect(req.url.startsWith('http://db:6333/collections/x')).toBe(true); // trailing slash normalisiert
    expect(req.headers['api-key']).toBe('db-key');
  });

  test('leere Runtime → ENV greift', () => {
    process.env.QDRANT_URL = 'http://env:6333';
    process.env.QDRANT_API_KEY = 'env-key';
    const c = new QdrantClient({ http: new InMemoryHttpClient() });
    expect(c._baseUrl()).toBe('http://env:6333');
    expect(c._headers()['api-key']).toBe('env-key');
  });

  test('explizite Ctor-Args gewinnen über Runtime (Test-Injektion)', () => {
    setQdrantRuntimeConfig({ url: 'http://db:6333', apiKey: 'db-key' });
    const c = new QdrantClient({ url: 'http://explicit:6333', apiKey: 'explicit', http: new InMemoryHttpClient() });
    expect(c._baseUrl()).toBe('http://explicit:6333');
    expect(c._headers()['api-key']).toBe('explicit');
  });

  test('ohne alles → Default-URL, kein api-key-Header', () => {
    const c = new QdrantClient({ http: new InMemoryHttpClient() });
    expect(c._baseUrl()).toBe('http://127.0.0.1:6333');
    expect(c._headers()).toEqual({});
  });
});

describe('QdrantClient.ping', () => {
  test('erreichbar → { ok:true }', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/collections', 200, { result: { collections: [] } });
    const c = new QdrantClient({ url: 'http://q:6333', http });
    await expect(c.ping()).resolves.toEqual({ ok: true });
  });

  test('Fehler propagiert (kein stilles false)', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/collections', 403, { status: 'forbidden' });
    const c = new QdrantClient({ url: 'http://q:6333', http });
    await expect(c.ping()).rejects.toThrow(/403/);
  });
});
