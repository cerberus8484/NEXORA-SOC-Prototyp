'use strict';

// ── Route-Tests /api/v1/auth/webauthn (Factory + injizierte Fakes) ──────────
// Deckt Gate (503), Auth-Schutz, Flow-Cookie-Round-Trip, Session-Ausgabe + die
// einheitliche 401-Härtung ab — ohne echte Lib/Authenticator.

const express = require('express');
const request = require('supertest');
const { createWebauthnRouter } = require('../../src/routes/webauthn');

const JWT_SECRET = 'test-secret-min-32-chars-aaaaaaaaaaaaaa';

function buildApp({ enabled = true, webAuthnService = {}, credentialRepo = {}, user = { sub: 'u1', email: 'a@x' } } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.id = 'rid'; next(); });
  const requireAuth = (req, res, next) => {
    if (req.headers['x-fake-auth'] === 'no') return res.status(401).json({ error: 'unauth' });
    req.user = user;
    next();
  };
  const router = createWebauthnRouter({
    webAuthnService,
    credentialRepo,
    config: { webauthn: { enabled } },
    logger: { error: () => {}, warn: () => {} },
    jwtSecret: JWT_SECRET,
    requireAuth,
    setTokenCookie: (res, t) => res.cookie('soc_token', t),
    setCsrfCookie:  (res) => res.cookie('csrf_token', 'csrf'),
  });
  app.use('/api/v1/auth/webauthn', router);
  return app;
}

describe('GET /status', () => {
  test('liefert enabled:true bzw. false (kein Gate)', async () => {
    expect((await request(buildApp({ enabled: true })).get('/api/v1/auth/webauthn/status')).body).toEqual({ enabled: true });
    expect((await request(buildApp({ enabled: false })).get('/api/v1/auth/webauthn/status')).body).toEqual({ enabled: false });
  });
});

describe('Gate (WEBAUTHN_ENABLED aus)', () => {
  test('login/options → 503', async () => {
    const res = await request(buildApp({ enabled: false })).post('/api/v1/auth/webauthn/login/options');
    expect(res.status).toBe(503);
  });
});

describe('register (requireAuth + Flow-Bindung)', () => {
  test('register/options ohne Auth → 401', async () => {
    const res = await request(buildApp()).post('/api/v1/auth/webauthn/register/options').set('x-fake-auth', 'no');
    expect(res.status).toBe(401);
  });

  test('Round-Trip: options setzt Flow-Cookie → verify speichert (201)', async () => {
    const webAuthnService = {
      beginRegistration: async (u) => ({ options: { challenge: 'ch' }, flow: { challenge: 'ch', userId: u.id, type: 'registration' } }),
      finishRegistration: async ({ flow }) => ({ id: 'c1', label: 'Key', userId: flow.userId }),
    };
    const agent = request.agent(buildApp({ webAuthnService }));
    const opt = await agent.post('/api/v1/auth/webauthn/register/options');
    expect(opt.status).toBe(200);
    expect(opt.headers['set-cookie'].join()).toMatch(/webauthn_flow=/);
    const ver = await agent.post('/api/v1/auth/webauthn/register/verify').send({ response: {}, label: 'Key' });
    expect(ver.status).toBe(201);
    expect(ver.body.data.label).toBe('Key');
  });

  test('verify ohne Flow-Cookie → 400', async () => {
    const res = await request(buildApp()).post('/api/v1/auth/webauthn/register/verify').send({ response: {} });
    expect(res.status).toBe(400);
  });
});

describe('login (usernamelos)', () => {
  test('Round-Trip: options → verify stellt Session aus', async () => {
    const webAuthnService = {
      beginAuthentication: async () => ({ options: { challenge: 'ch' }, flow: { challenge: 'ch', type: 'authentication' } }),
      finishAuthentication: async () => ({ token: 'tok', user: { id: 'u1' } }),
    };
    const agent = request.agent(buildApp({ webAuthnService }));
    await agent.post('/api/v1/auth/webauthn/login/options');
    const ver = await agent.post('/api/v1/auth/webauthn/login/verify').send({ response: { id: 'c1' } });
    expect(ver.status).toBe(200);
    expect(ver.body.user.id).toBe('u1');
    expect(ver.headers['set-cookie'].join()).toMatch(/soc_token=tok/);
  });

  test('finishAuthentication wirft WebAuthnError → einheitlicher 401', async () => {
    const err = new Error('x'); err.name = 'WebAuthnError';
    const webAuthnService = {
      beginAuthentication: async () => ({ options: {}, flow: { challenge: 'ch' } }),
      finishAuthentication: async () => { throw err; },
    };
    const agent = request.agent(buildApp({ webAuthnService }));
    await agent.post('/api/v1/auth/webauthn/login/options');
    const ver = await agent.post('/api/v1/auth/webauthn/login/verify').send({ response: { id: 'c1' } });
    expect(ver.status).toBe(401);
    expect(ver.body.error).toBe('webauthn_failed');
  });
});

describe('credentials-Verwaltung', () => {
  test('GET /credentials → Listing-Sicht; DELETE ownership (404 wenn fremd)', async () => {
    const credentialRepo = {
      findByUserId: async () => [{ toPublicJSON: () => ({ id: 'c1', label: 'Key' }) }],
      deleteById:   async (id) => id === 'c1',
    };
    const app = buildApp({ credentialRepo });
    const list = await request(app).get('/api/v1/auth/webauthn/credentials');
    expect(list.body.data[0].label).toBe('Key');
    expect((await request(app).delete('/api/v1/auth/webauthn/credentials/c1')).status).toBe(200);
    expect((await request(app).delete('/api/v1/auth/webauthn/credentials/other')).status).toBe(404);
  });
});
