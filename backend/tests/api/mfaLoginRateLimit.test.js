'use strict';

jest.setTimeout(30000);

// ── Security (HIGH, Code-Scan 2026-07-03): MFA-Verifikation OHNE Rate-Limit ──
// Die 2.-Faktor-Verifikation (POST /auth/mfa) war brute-forcebar: im 5-min-
// Challenge-Fenster ~1000 TOTP-Rateversuche gegen den 6-stelligen Code (setzt ein
// gültiges Passwort voraus — der Login-Limiter greift dort). Diese Suite fixiert
// den Brute-Force-Schutz:
//   - pro Challenge-Token gekappt (nicht global → NAT-transparent, kappt je Challenge)
//   - nur FEHLVERSUCHE zählen (skipSuccessfulRequests) → legitimer Code nie blockiert
//   - ein anderer Challenge-Token hat einen eigenen Zähler (Keying-Beweis)
//   - die 429-Response leakt den Challenge-Token nicht

const request = require('supertest');
const { totpToken } = require('../../src/mfa/totp');

const ORIG = {
  MFA_ENABLED:         process.env.MFA_ENABLED,
  MFA_VERIFY_MAX:      process.env.MFA_VERIFY_MAX,
  MFA_VERIFY_WINDOW_MS: process.env.MFA_VERIFY_WINDOW_MS,
};

function restore(key) {
  if (ORIG[key] === undefined) delete process.env[key];
  else process.env[key] = ORIG[key];
}

describe('/api/v1/auth/mfa — Brute-Force-Rate-Limit', () => {
  let app;
  let authService;
  const PW    = 'Test1234!';
  const LIMIT = 3; // Test-Limit (Prod-Default 5)

  beforeAll(() => {
    process.env.MFA_ENABLED          = 'true';
    process.env.MFA_VERIFY_MAX       = String(LIMIT);
    process.env.MFA_VERIFY_WINDOW_MS = '60000';
    jest.resetModules();
    app         = require('../../src/app');
    authService = require('../../src/services/AuthService').authService;
  });

  afterAll(() => {
    restore('MFA_ENABLED');
    restore('MFA_VERIFY_MAX');
    restore('MFA_VERIFY_WINDOW_MS');
    jest.resetModules();
  });

  beforeEach(() => {
    authService._users.clear();
    authService._blocklist.clear();
    require('../../src/services/MfaService').mfaService._getRepo().clear();
  });

  // Legt einen User mit aktiver MFA an, gibt { email, secret, token } zurück.
  // token = die vor der MFA-Aktivierung ausgestellte Session (bleibt gültig) —
  // genügt für authentifizierte /mfa/*-Aufrufe.
  async function makeUserWithMfa() {
    const email = `mfarl-${Date.now()}-${Math.random().toString(36).slice(2)}@x.io`;
    await authService.register({ email, password: PW, displayName: 'U', role: 'analyst' });
    const login  = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
    const token  = login.body.token;
    const enroll = await request(app).post('/api/v1/mfa/enroll').set('Authorization', `Bearer ${token}`);
    await request(app).post('/api/v1/mfa/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: totpToken(enroll.body.secret) });
    return { email, secret: enroll.body.secret, token };
  }

  // Frischer Challenge-Token via Passwort-Login.
  async function challenge(email) {
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
    return login.body.challengeToken;
  }

  test('nach LIMIT Fehlversuchen auf einem Challenge-Token → 429 statt 401', async () => {
    const { email } = await makeUserWithMfa();
    const ct = await challenge(email);

    for (let i = 0; i < LIMIT; i++) {
      const r = await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ct, code: '000000' });
      expect(r.status).toBe(401);
    }

    const blocked = await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ct, code: '000000' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('TOO_MANY_REQUESTS');
    expect(blocked.headers['retry-after'] || blocked.headers['ratelimit-reset']).toBeDefined();
  });

  test('erfolgreicher Code zählt nicht zum Limit (skipSuccessfulRequests)', async () => {
    const { email, secret } = await makeUserWithMfa();
    const ct = await challenge(email);

    for (let i = 0; i < LIMIT - 1; i++) {
      await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ct, code: '000000' });
    }
    const ok = await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ct, code: totpToken(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
  });

  test('ein anderer Challenge-Token hat einen eigenen Zähler (per-Challenge-Keying)', async () => {
    const { email, secret } = await makeUserWithMfa();
    const ctA = await challenge(email);

    for (let i = 0; i <= LIMIT; i++) {
      await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ctA, code: '000000' });
    }
    const blockedA = await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ctA, code: '000000' });
    expect(blockedA.status).toBe(429);

    // Frischer Challenge-Token → eigener Zähler, korrekter Code klappt.
    const ctB = await challenge(email);
    const ok  = await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ctB, code: totpToken(secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
  });

  test('429-Response leakt den Challenge-Token nicht (Body + Header)', async () => {
    const { email } = await makeUserWithMfa();
    const ct = await challenge(email);

    for (let i = 0; i <= LIMIT; i++) {
      await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ct, code: '000000' });
    }
    const res = await request(app).post('/api/v1/auth/mfa').send({ challengeToken: ct, code: '000000' });
    expect(res.status).toBe(429);
    expect(JSON.stringify(res.body)).not.toContain(ct);
    expect(JSON.stringify(res.headers)).not.toContain(ct);
  });

  // ── Zweite Angriffsfläche: /mfa/disable prüft ebenfalls einen Code (Session-
  // authentifiziert). mfaUserLimiter kappt das Raten pro User. ──────────────────
  test('/mfa/disable: nach LIMIT falschen Codes → 429 (pro User gekappt)', async () => {
    const { token } = await makeUserWithMfa();

    for (let i = 0; i < LIMIT; i++) {
      const r = await request(app).post('/api/v1/mfa/disable')
        .set('Authorization', `Bearer ${token}`).send({ code: '000000' });
      expect(r.status).toBe(400); // ValidationError „Gültiger Code erforderlich"
    }
    const blocked = await request(app).post('/api/v1/mfa/disable')
      .set('Authorization', `Bearer ${token}`).send({ code: '000000' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('TOO_MANY_REQUESTS');
  });
});
