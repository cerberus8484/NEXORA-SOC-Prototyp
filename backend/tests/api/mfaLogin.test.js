'use strict';

// ── Phase 4: Login-Challenge (2. Faktor) ─────────────────────────────────────
// Bei aktiver MFA gibt der Passwort-Login KEIN Session-Token mehr zurück, sondern
// eine kurzlebige Challenge. Erst /auth/mfa mit gültigem Code liefert das Token.

const request = require('supertest');
const { totpToken } = require('../../src/mfa/totp');

const ORIGINAL_MFA_ENABLED = process.env.MFA_ENABLED;

describe('/api/v1/auth — Login-Challenge mit MFA_ENABLED=true', () => {
  let app;
  let authService;

  const PW = 'Test1234!';

  beforeAll(() => {
    process.env.MFA_ENABLED = 'true';
    jest.resetModules();
    app         = require('../../src/app');
    authService = require('../../src/services/AuthService').authService;
  });

  afterAll(() => {
    process.env.MFA_ENABLED = ORIGINAL_MFA_ENABLED;
    jest.resetModules();
  });

  beforeEach(() => {
    authService._users.clear();
    authService._blocklist.clear();
    require('../../src/services/MfaService').mfaService._getRepo().clear();
  });

  async function makeUser(role = 'analyst') {
    const email = `mfalogin-${Date.now()}-${Math.random().toString(36).slice(2)}@x.io`;
    await authService.register({ email, password: PW, displayName: 'U', role });
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
    return { email, token: login.body.token };
  }

  // Hilfsfunktion: enroll + aktiviere MFA für den eingeloggten User, gibt secret zurück
  async function activateMfa(token) {
    const enroll = await request(app).post('/api/v1/mfa/enroll').set('Authorization', `Bearer ${token}`);
    await request(app).post('/api/v1/mfa/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: totpToken(enroll.body.secret) });
    return enroll.body.secret;
  }

  test('User OHNE MFA loggt normal ein (Token im Body)', async () => {
    const { email } = await makeUser();
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.mfaRequired).toBeUndefined();
  });

  test('User MIT aktiver MFA bekommt Challenge statt Token', async () => {
    const { email, token } = await makeUser();
    await activateMfa(token);

    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    expect(res.body.challengeToken).toBeTruthy();
    expect(res.body.token).toBeUndefined();           // KEIN Session-Token
    // kein Session-Cookie gesetzt
    expect(res.headers['set-cookie'] || []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('soc_token=')]),
    );
  });

  test('Challenge-Token kann KEINE geschützte Route öffnen (zentrale Härtung)', async () => {
    const { email, token } = await makeUser();
    await activateMfa(token);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: PW });

    const me = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.challengeToken}`);
    expect(me.status).toBe(401);
  });

  test('POST /auth/mfa mit gültigem Code liefert das echte Session-Token', async () => {
    const { email, token } = await makeUser();
    const secret = await activateMfa(token);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: PW });

    const res = await request(app).post('/api/v1/auth/mfa')
      .send({ challengeToken: login.body.challengeToken, code: totpToken(secret) });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(email);

    // das echte Token öffnet geschützte Routen
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
  });

  test('POST /auth/mfa mit falschem Code → 401, kein Token', async () => {
    const { email, token } = await makeUser();
    await activateMfa(token);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: PW });

    const res = await request(app).post('/api/v1/auth/mfa')
      .send({ challengeToken: login.body.challengeToken, code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test('POST /auth/mfa mit Recovery-Code funktioniert (einmalig)', async () => {
    const { email, token } = await makeUser();
    const enroll = await request(app).post('/api/v1/mfa/enroll').set('Authorization', `Bearer ${token}`);
    const verify = await request(app).post('/api/v1/mfa/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: totpToken(enroll.body.secret) });
    const recovery = verify.body.recoveryCodes[0];

    const login = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
    const res = await request(app).post('/api/v1/auth/mfa')
      .send({ challengeToken: login.body.challengeToken, code: recovery });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  test('falsches Passwort gibt KEINE Challenge (klassisch 401)', async () => {
    const { email, token } = await makeUser();
    await activateMfa(token);
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Wrong999!' });
    expect(res.status).toBe(401);
    expect(res.body.challengeToken).toBeUndefined();
  });

  // ── Security (OWASP A07): MFA-Fehlerpfade sind ununterscheidbar ─────────────
  // Ein Angreifer darf nicht zwischen „Challenge ungültig/abgelaufen" und
  // „falscher Code" unterscheiden können. Status UND Meldung müssen identisch sein.
  describe('MFA-Fehlerpfade liefern eine einheitliche, nicht-diskriminierende Antwort', () => {
    test('ungültiges Challenge-Token und richtiger-Challenge-aber-falscher-Code → identischer Status + identische Meldung', async () => {
      const { email, token } = await makeUser();
      await activateMfa(token);

      // (a) Ungültiges/abgelaufenes Challenge-Token (kein gültiges JWT).
      const invalidChallenge = await request(app).post('/api/v1/auth/mfa')
        .send({ challengeToken: 'not-a-valid-jwt', code: '000000' });

      // (b) Gültige Challenge, aber falscher Code.
      const login = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
      const wrongCode = await request(app).post('/api/v1/auth/mfa')
        .send({ challengeToken: login.body.challengeToken, code: '000000' });

      // Beide: 401, kein Token, IDENTISCHE Fehlermeldung.
      expect(invalidChallenge.status).toBe(401);
      expect(wrongCode.status).toBe(401);
      expect(invalidChallenge.status).toBe(wrongCode.status);

      expect(invalidChallenge.body.token).toBeUndefined();
      expect(wrongCode.body.token).toBeUndefined();

      expect(invalidChallenge.body.message).toBeTruthy();
      expect(invalidChallenge.body.message).toBe(wrongCode.body.message);
      // Meldung darf den konkreten Grund nicht preisgeben (kein „Code", kein „abgelaufen" als Unterscheidung).
      expect(invalidChallenge.body.message).toBe(
        'Zwei-Faktor-Bestätigung fehlgeschlagen — Code ungültig oder Sitzung abgelaufen.',
      );
    });

    test('abgelaufenes Challenge-Token vs. falscher Code: ununterscheidbar (gleicher Status + Meldung)', async () => {
      const { email, token } = await makeUser();
      const secret = await activateMfa(token);

      // Künstlich abgelaufenes Challenge-Token (purpose korrekt, aber expired).
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../../src/services/AuthService');
      const user = await authService._findByEmail(email);
      const expiredChallenge = jwt.sign(
        { sub: user.id, purpose: 'mfa_challenge' }, JWT_SECRET, { expiresIn: '-1s' },
      );
      const expiredRes = await request(app).post('/api/v1/auth/mfa')
        .send({ challengeToken: expiredChallenge, code: totpToken(secret) });

      // Gültige Challenge, aber falscher Code.
      const login = await request(app).post('/api/v1/auth/login').send({ email, password: PW });
      const wrongCodeRes = await request(app).post('/api/v1/auth/mfa')
        .send({ challengeToken: login.body.challengeToken, code: '000000' });

      expect(expiredRes.status).toBe(401);
      expect(wrongCodeRes.status).toBe(401);
      expect(expiredRes.body.message).toBe(wrongCodeRes.body.message);
      expect(expiredRes.body.token).toBeUndefined();
      expect(wrongCodeRes.body.token).toBeUndefined();
    });
  });
});
