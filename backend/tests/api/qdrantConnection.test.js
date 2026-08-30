'use strict';

// Layer 2: Qdrant-Verbindung aus der UI verwalten.
//
// GET  /api/v1/rag/qdrant-connection       — maskiert (admin; nie Key)
// PUT  /api/v1/rag/qdrant-connection       — speichern (admin + Passwort-Step-up + Audit)
// POST /api/v1/rag/qdrant-connection/test  — Verbindungstest (admin)

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { QDRANT_CONNECTION_KEY } = require('../../src/services/qdrantConnectionSettings');
const { setQdrantRuntimeConfig } = require('../../src/rag/QdrantClient');
const { isEncrypted } = require('../../src/config/secretsCrypto');

let adminToken, analystToken;
const ADMIN_PW = 'Test1234!';

async function tokenFor(role, suffix) {
  const email = `qd-${role}-${suffix}@x.io`;
  await authService.register({ email, password: ADMIN_PW, displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: ADMIN_PW });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  const suffix = `${Date.now()}-${Math.random()}`;
  adminToken   = await tokenFor('admin', suffix);
  analystToken = await tokenFor('analyst', suffix);
  await createSettingsRepository().set(QDRANT_CONNECTION_KEY, {});
  auditService.clearLog();
});

// Hermetisch bleiben: PUT wendet die Verbindung über die modulweite Qdrant-Runtime-
// Config an (setQdrantRuntimeConfig) und schreibt in den Settings-Singleton. Beides
// nach der Suite zurücksetzen, sonst greifen spätere RAG-Suiten eine geleakte URL.
afterEach(() => {
  setQdrantRuntimeConfig({ url: '', apiKey: '' });
});
afterAll(async () => {
  await createSettingsRepository().set(QDRANT_CONNECTION_KEY, {});
  setQdrantRuntimeConfig({ url: '', apiKey: '' });
});

const getConn = (token) => {
  const req = request(app).get('/api/v1/rag/qdrant-connection');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const putConn = (token, body) =>
  request(app).put('/api/v1/rag/qdrant-connection').set('Authorization', `Bearer ${token}`).send(body);
const testConn = (token, body) =>
  request(app).post('/api/v1/rag/qdrant-connection/test').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/rag/qdrant-connection', () => {
  test('admin → 200, maskiert (apiKeySet + source), nie Key', async () => {
    const res = await getConn(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('apiKeySet');
    expect(res.body.data).not.toHaveProperty('apiKey');
  });
  test('analyst → 403 · unauth → 401', async () => {
    expect((await getConn(analystToken)).status).toBe(403);
    expect((await getConn(null)).status).toBe(401);
  });
});

describe('PUT /api/v1/rag/qdrant-connection', () => {
  const VALID = { password: ADMIN_PW, url: 'http://10.0.10.40:6333', apiKey: 'qdrant-key' };

  test('admin + korrektes Passwort → 200, Key verschlüsselt, Audit ohne Key', async () => {
    const res = await putConn(adminToken, VALID);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ url: 'http://10.0.10.40:6333', apiKeySet: true, source: 'db' });
    const stored = await createSettingsRepository().get(QDRANT_CONNECTION_KEY);
    expect(isEncrypted(stored.apiKey)).toBe(true);
    const audit = auditService.getLog().find((e) => e.action === 'QDRANT_CONNECTION_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('qdrant-key');
  });

  test('URL ohne Key erlaubt (Qdrant ohne Auth) → 200', async () => {
    const res = await putConn(adminToken, { password: ADMIN_PW, url: 'http://10.0.10.40:6333', apiKey: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.apiKeySet).toBe(false);
  });

  test('falsches Passwort → 403 + Denied-Audit, nichts gespeichert', async () => {
    const res = await putConn(adminToken, { ...VALID, password: 'falsch' });
    expect(res.status).toBe(403);
    expect((await createSettingsRepository().get(QDRANT_CONNECTION_KEY)).url).toBeUndefined();
    expect(auditService.getLog().some((e) => e.action === 'QDRANT_CONNECTION_CHANGE_DENIED')).toBe(true);
  });

  test('externe URL (nicht intern) → 400', async () => {
    const res = await putConn(adminToken, { password: ADMIN_PW, url: 'https://evil.example.com:6333', apiKey: 'k' });
    expect(res.status).toBe(400);
  });

  test('fehlendes Passwort → 400', async () => {
    expect((await putConn(adminToken, { url: 'http://10.0.10.40:6333', apiKey: 'k' })).status).toBe(400);
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putConn(analystToken, VALID)).status).toBe(403);
    expect((await request(app).put('/api/v1/rag/qdrant-connection').send(VALID)).status).toBe(401);
  });
});

describe('POST /api/v1/rag/qdrant-connection/test', () => {
  test('externe/Loopback-URL → 400', async () => {
    expect((await testConn(adminToken, { url: 'https://evil.example.com' })).status).toBe(400);
  });
  test('Test schreibt Audit (Host + Ergebnis, nie Key)', async () => {
    // Loopback mit totem Port → sofortiges ECONNREFUSED (kein Netzwerk-Hang im Test).
    await testConn(adminToken, { url: 'http://127.0.0.1:6399', apiKey: 'secret-key' });
    const audit = auditService.getLog().find((e) => e.action === 'QDRANT_CONNECTION_TEST');
    expect(audit).toBeDefined();
    expect(audit.metadata.host).toBe('127.0.0.1:6399');
    expect(JSON.stringify(audit.metadata)).not.toContain('secret-key');
  });
  test('analyst → 403', async () => {
    expect((await testConn(analystToken, {})).status).toBe(403);
  });
});
