'use strict';

// ── TDD RED: API-Tests für /api/v1/tokens ────────────────────────────────────

const request = require('supertest');

// API_TOKENS_ENABLED muss VOR dem Laden von app gesetzt werden
const ORIGINAL_TOKENS_ENABLED = process.env.API_TOKENS_ENABLED;

describe('GET/POST/DELETE /api/v1/tokens — API_TOKENS_ENABLED=false (default)', () => {
  let app;

  beforeAll(() => {
    delete process.env.API_TOKENS_ENABLED;
    jest.resetModules();
    app = require('../../src/app');
  });

  afterAll(() => {
    process.env.API_TOKENS_ENABLED = ORIGINAL_TOKENS_ENABLED;
    jest.resetModules();
  });

  test('GET /api/v1/tokens gibt 503 zurück wenn disabled', async () => {
    const res = await request(app).get('/api/v1/tokens').set('Authorization', 'Bearer dummy');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('API_TOKENS_DISABLED');
  });

  test('POST /api/v1/tokens gibt 503 zurück wenn disabled', async () => {
    const res = await request(app).post('/api/v1/tokens').send({ name: 'Test' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('API_TOKENS_DISABLED');
  });

  test('DELETE /api/v1/tokens/:id gibt 503 zurück wenn disabled', async () => {
    const res = await request(app).delete('/api/v1/tokens/some-id');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('API_TOKENS_DISABLED');
  });
});

describe('/api/v1/tokens — API_TOKENS_ENABLED=true', () => {
  let app;
  let authService;
  let apiTokenService;

  let analystToken, analystId;
  let viewerToken;

  beforeAll(() => {
    process.env.API_TOKENS_ENABLED = 'true';
    jest.resetModules();
    app            = require('../../src/app');
    authService    = require('../../src/services/AuthService').authService;
    apiTokenService = require('../../src/services/ApiTokenService').apiTokenService;
  });

  afterAll(() => {
    process.env.API_TOKENS_ENABLED = ORIGINAL_TOKENS_ENABLED;
    jest.resetModules();
  });

  beforeEach(async () => {
    authService._users.clear();
    authService._blocklist.clear();
    apiTokenService._getRepo().clear();

    // Analyst
    const aEmail = `tok-analyst-${Date.now()}@x.io`;
    await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'A', role: 'analyst' });
    const aLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: aEmail, password: 'Test1234!' });
    analystToken = aLogin.body.token;
    analystId    = aLogin.body.user.id;

    // Viewer
    const vEmail = `tok-viewer-${Date.now()}@x.io`;
    await authService.register({ email: vEmail, password: 'Test1234!', displayName: 'V', role: 'viewer' });
    const vLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: vEmail, password: 'Test1234!' });
    viewerToken = vLogin.body.token;
  });

  // ─── GET /api/v1/tokens ──────────────────────────────────────────────────

  describe('GET /api/v1/tokens', () => {
    test('401 ohne Auth', async () => {
      const res = await request(app).get('/api/v1/tokens');
      expect(res.status).toBe(401);
    });

    test('200 + leere Liste wenn keine Tokens', async () => {
      const res = await request(app)
        .get('/api/v1/tokens')
        .set('Authorization', `Bearer ${analystToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    test('200 + Token-Liste (ohne tokenHash)', async () => {
      await apiTokenService.create({ userId: analystId, name: 'Skript A' });
      await apiTokenService.create({ userId: analystId, name: 'Skript B' });

      const res = await request(app)
        .get('/api/v1/tokens')
        .set('Authorization', `Bearer ${analystToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      res.body.data.forEach(t => {
        expect(t).not.toHaveProperty('tokenHash');
        expect(t).not.toHaveProperty('token_hash');
        expect(t).toHaveProperty('prefix');
        expect(t).toHaveProperty('name');
      });
    });

    test('User-Scoping: gibt nur eigene Tokens zurück', async () => {
      // Ein zweiter User
      const b2Email = `tok-b2-${Date.now()}@x.io`;
      await authService.register({ email: b2Email, password: 'Test1234!', displayName: 'B2', role: 'analyst' });
      const b2Login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: b2Email, password: 'Test1234!' });
      const b2Id = b2Login.body.user.id;

      await apiTokenService.create({ userId: analystId, name: 'A-Token' });
      await apiTokenService.create({ userId: b2Id,      name: 'B-Token' });

      const res = await request(app)
        .get('/api/v1/tokens')
        .set('Authorization', `Bearer ${analystToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('A-Token');
    });

    test('viewer darf eigene Tokens lesen', async () => {
      const res = await request(app)
        .get('/api/v1/tokens')
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /api/v1/tokens ─────────────────────────────────────────────────

  describe('POST /api/v1/tokens', () => {
    test('401 ohne Auth', async () => {
      const res = await request(app)
        .post('/api/v1/tokens')
        .send({ name: 'Test' });
      expect(res.status).toBe(401);
    });

    test('201 + einmaligen Token-Wert zurückgeben', async () => {
      const res = await request(app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${analystToken}`)
        .send({ name: 'Neues Skript' });
      expect(res.status).toBe(201);
      expect(res.body.token).toMatch(/^soc_[0-9a-f]{64}$/);
      expect(res.body.apiToken).toBeDefined();
      expect(res.body.apiToken).not.toHaveProperty('tokenHash');
    });

    test('400 wenn name fehlt', async () => {
      const res = await request(app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${analystToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    test('400 wenn name leer', async () => {
      const res = await request(app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${analystToken}`)
        .send({ name: '' });
      expect(res.status).toBe(400);
    });

    test('Token-Wert erscheint NUR in der Create-Response (einmalig)', async () => {
      // Nach dem Erstellen soll der Plain-Token nicht mehr über GET abrufbar sein
      const createRes = await request(app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${analystToken}`)
        .send({ name: 'Einmalig' });
      expect(createRes.status).toBe(201);

      const listRes = await request(app)
        .get('/api/v1/tokens')
        .set('Authorization', `Bearer ${analystToken}`);
      const listBody = JSON.stringify(listRes.body);
      // Der echte Token-Wert darf nicht in der Liste erscheinen
      expect(listBody).not.toContain(createRes.body.token.slice(4)); // hex-Teil
    });

    test('viewer kann Token erstellen', async () => {
      const res = await request(app)
        .post('/api/v1/tokens')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'Viewer-Skript' });
      expect(res.status).toBe(201);
    });
  });

  // ─── DELETE /api/v1/tokens/:id ───────────────────────────────────────────

  describe('DELETE /api/v1/tokens/:id', () => {
    test('401 ohne Auth', async () => {
      const res = await request(app).delete('/api/v1/tokens/some-id');
      expect(res.status).toBe(401);
    });

    test('204 beim Widerrufen des eigenen Tokens', async () => {
      const { apiToken } = await apiTokenService.create({ userId: analystId, name: 'Del-Test' });
      const res = await request(app)
        .delete(`/api/v1/tokens/${apiToken.id}`)
        .set('Authorization', `Bearer ${analystToken}`);
      expect(res.status).toBe(204);
    });

    test('404 wenn Token nicht existiert', async () => {
      const res = await request(app)
        .delete('/api/v1/tokens/nonexistent-id')
        .set('Authorization', `Bearer ${analystToken}`);
      expect(res.status).toBe(404);
    });

    test('404 wenn Token einem anderen User gehört', async () => {
      const b3Email = `tok-b3-${Date.now()}@x.io`;
      await authService.register({ email: b3Email, password: 'Test1234!', displayName: 'B3', role: 'analyst' });
      const b3Login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: b3Email, password: 'Test1234!' });
      const b3Id = b3Login.body.user.id;

      const { apiToken } = await apiTokenService.create({ userId: b3Id, name: 'B3-Token' });

      const res = await request(app)
        .delete(`/api/v1/tokens/${apiToken.id}`)
        .set('Authorization', `Bearer ${analystToken}`);
      expect(res.status).toBe(404);
    });
  });
});
