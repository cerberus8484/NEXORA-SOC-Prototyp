'use strict';

// OIDC Slice 2 — Route-Schicht (Gate, Flow-Cookie, Redirects) — netzfrei via Factory.
const express      = require('express');
const request      = require('supertest');
const jwt          = require('jsonwebtoken');
const { createOidcRouter } = require('../../src/routes/oidc');

const JWT_SECRET = 'test-secret-at-least-32-chars-long-aaaa';
const AUTHZ_URL  = 'https://idp.example.com/realms/soc/auth?response_type=code&state=st';

function buildApp({ enabled = true, oidcService = {} } = {}) {
  const app = express();
  const audits = [];
  const router = createOidcRouter({
    oidcService,
    config:        { oidc: { enabled } },
    logger:        { warn() {}, error() {} },
    auditService:  { write: async (e) => { audits.push(e); } },
    AUDIT_ACTIONS: { LOGIN: 'auth.login', LOGIN_FAILED: 'auth.login_failed' },
    jwtSecret:     JWT_SECRET,
    setTokenCookie: (res, token) => res.cookie('soc_token', token, { httpOnly: true }),
    setCsrfCookie:  (res) => res.cookie('csrf_token', 'csrf-xyz'),
  });
  app.use('/api/v1/auth/oidc', router);
  return { app, audits };
}

const flowCookie = (flow = { state: 'st', nonce: 'no', codeVerifier: 'cv' }) =>
  `oidc_flow=${jwt.sign({ ...flow, purpose: 'oidc_flow' }, JWT_SECRET, { expiresIn: '10m' })}`;

describe('GET /auth/oidc/status', () => {
  test('liefert enabled=false ohne Gate', async () => {
    const { app } = buildApp({ enabled: false });
    const res = await request(app).get('/api/v1/auth/oidc/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
  });

  test('liefert enabled=true wenn aktiv', async () => {
    const { app } = buildApp({ enabled: true });
    const res = await request(app).get('/api/v1/auth/oidc/status');
    expect(res.body).toEqual({ enabled: true });
  });
});

describe('Hard-Gate (OIDC_ENABLED=false)', () => {
  test('/login → 503', async () => {
    const { app } = buildApp({ enabled: false });
    expect((await request(app).get('/api/v1/auth/oidc/login')).status).toBe(503);
  });

  test('/callback → 503', async () => {
    const { app } = buildApp({ enabled: false });
    expect((await request(app).get('/api/v1/auth/oidc/callback?code=x&state=y')).status).toBe(503);
  });
});

describe('GET /auth/oidc/login', () => {
  test('302 zum IdP + signierter Flow-Cookie (purpose=oidc_flow)', async () => {
    const oidcService = {
      beginLogin: async () => ({ authorizationUrl: AUTHZ_URL, flow: { state: 'st', nonce: 'no', codeVerifier: 'cv' } }),
    };
    const { app } = buildApp({ oidcService });
    const res = await request(app).get('/api/v1/auth/oidc/login');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(AUTHZ_URL);

    const setCookie = res.headers['set-cookie'].find((c) => c.startsWith('oidc_flow='));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const value = decodeURIComponent(setCookie.split(';')[0].split('=').slice(1).join('='));
    const decoded = jwt.verify(value, JWT_SECRET);
    expect(decoded.purpose).toBe('oidc_flow');
    expect(decoded.state).toBe('st');
  });

  test('beginLogin wirft (IdP nicht erreichbar) → 302 nach /login?sso_error=1', async () => {
    const oidcService = { beginLogin: async () => { throw new Error('discovery down'); } };
    const { app } = buildApp({ oidcService });
    const res = await request(app).get('/api/v1/auth/oidc/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso_error=1');
  });
});

describe('GET /auth/oidc/callback', () => {
  test('Erfolg → Session-Cookie + 302 nach / + Audit (sso:true)', async () => {
    const completeLogin = jest.fn(async () => ({
      session: { token: 'session-tok', jti: 'j', user: {} },
      userId: 'u-1', email: 'user@firma.de', linkMode: 'linked',
    }));
    const { app, audits } = buildApp({ oidcService: { completeLogin } });

    const res = await request(app)
      .get('/api/v1/auth/oidc/callback?code=auth-code&state=st')
      .set('Cookie', flowCookie());

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    // Flow aus Cookie korrekt extrahiert + an den Service gereicht.
    expect(completeLogin).toHaveBeenCalledWith({
      code: 'auth-code', returnedState: 'st',
      flow: { state: 'st', nonce: 'no', codeVerifier: 'cv' },
    });
    // Session-Cookie gesetzt, Flow-Cookie gelöscht.
    const cookies = res.headers['set-cookie'].join('\n');
    expect(cookies).toMatch(/soc_token=session-tok/);
    expect(cookies).toMatch(/oidc_flow=;/);
    // Audit: erfolgreicher SSO-Login.
    expect(audits.some((a) => a.action === 'auth.login' && a.metadata.sso === true)).toBe(true);
  });

  test('OidcError → 302 nach /login?sso_error=1 + Audit LOGIN_FAILED (generisch)', async () => {
    const completeLogin = jest.fn(async () => { const e = new Error('x'); e.reason = 'state_mismatch'; throw e; });
    const { app, audits } = buildApp({ oidcService: { completeLogin } });

    const res = await request(app)
      .get('/api/v1/auth/oidc/callback?code=auth-code&state=forged')
      .set('Cookie', flowCookie());

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso_error=1');
    const failed = audits.find((a) => a.action === 'auth.login_failed');
    expect(failed).toBeTruthy();
    expect(failed.metadata.reason).toBe('sso_failed'); // generisch, kein interner Grund
  });

  test('ohne Flow-Cookie → completeLogin bekommt leeren Flow (Ablehnung greift im Service)', async () => {
    const completeLogin = jest.fn(async () => { const e = new Error('x'); e.reason = 'missing_flow'; throw e; });
    const { app } = buildApp({ oidcService: { completeLogin } });

    const res = await request(app).get('/api/v1/auth/oidc/callback?code=c&state=s');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?sso_error=1');
    expect(completeLogin).toHaveBeenCalledWith(expect.objectContaining({ flow: {} }));
  });
});
