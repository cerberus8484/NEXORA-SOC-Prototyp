'use strict';

// ── Org-weite MFA-Pflicht (mfaRequired) — Login erzwingt MFA-Enrollment ───────
// Sicherheitskritisch: Setup-Token autorisiert NUR das Enrollment, niemals
// geschützte Routen; nach Aktivierung volle Session.

const request = require('supertest');
const { totpToken } = require('../../src/mfa/totp');

const ORIG_MFA = process.env.MFA_ENABLED;

async function register(authService, role) {
  const email = `enf-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return email;
}
function login(app, email) {
  return request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
}

describe('Org-weite MFA-Pflicht — MFA_ENABLED=true', () => {
  let app, authService, adminToken;

  async function setRequired(value) {
    await request(app).put('/api/v1/settings/platform')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mfaRequired: value }).expect(200);
  }

  beforeAll(async () => {
    process.env.MFA_ENABLED = 'true';
    jest.resetModules();
    require('../../src/repositories/settingsRepositoryFactory')._resetInMemoryInstance();
    app         = require('../../src/app');
    authService = require('../../src/services/AuthService').authService;
    // Admin-Token holen, SOLANGE mfaRequired noch false ist (sonst Self-Lockout).
    const adminEmail = await register(authService, 'admin');
    const res = await login(app, adminEmail);
    adminToken = res.body.token;
    expect(adminToken).toBeTruthy();
  });

  afterAll(() => {
    if (ORIG_MFA === undefined) delete process.env.MFA_ENABLED; else process.env.MFA_ENABLED = ORIG_MFA;
    jest.resetModules();
  });

  test('mfaRequired=false → normaler Login mit Session-Token', async () => {
    await setRequired(false);
    const email = await register(authService, 'analyst');
    const res = await login(app, email);
    expect(res.body.token).toBeTruthy();
    expect(res.body.mfaSetupRequired).toBeUndefined();
  });

  test('mfaRequired=true + User ohne MFA → mfaSetupRequired + setupToken (KEIN Session-Token)', async () => {
    await setRequired(true);
    const email = await register(authService, 'analyst');
    const res = await login(app, email);
    expect(res.body.mfaSetupRequired).toBe(true);
    expect(res.body.setupToken).toBeTruthy();
    expect(res.body.token).toBeUndefined();
  });

  test('Setup-Token ist KEIN Session-Token: geschützte Route lehnt ab (401)', async () => {
    await setRequired(true);
    const email = await register(authService, 'analyst');
    const { body } = await login(app, email);
    const res = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${body.setupToken}`);
    expect(res.status).toBe(401);
  });

  test('voller Setup-Flow: begin → TOTP → complete → Session + Recovery-Codes; danach Login = Challenge', async () => {
    await setRequired(true);
    const email = await register(authService, 'analyst');
    const { body: loginBody } = await login(app, email);
    const setupToken = loginBody.setupToken;

    const begin = await request(app).post('/api/v1/auth/mfa-setup/begin').send({ setupToken });
    expect(begin.status).toBe(201);
    expect(begin.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(begin.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const complete = await request(app).post('/api/v1/auth/mfa-setup/complete')
      .send({ setupToken, code: totpToken(begin.body.secret) });
    expect(complete.status).toBe(200);
    expect(complete.body.token).toBeTruthy();              // volle Session
    expect(complete.body.recoveryCodes.length).toBeGreaterThanOrEqual(8);

    // Session-Token funktioniert auf geschützter Route
    const me = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${complete.body.token}`);
    expect(me.status).toBe(200);

    // Nächster Login: User hat jetzt aktive MFA → Challenge (NICHT mehr Setup).
    const next = await login(app, email);
    expect(next.body.mfaRequired).toBe(true);
    expect(next.body.challengeToken).toBeTruthy();
    expect(next.body.mfaSetupRequired).toBeUndefined();
  });

  test('complete mit falschem Code → 400, keine Session', async () => {
    await setRequired(true);
    const email = await register(authService, 'analyst');
    const { body } = await login(app, email);
    await request(app).post('/api/v1/auth/mfa-setup/begin').send({ setupToken: body.setupToken }).expect(201);
    const res = await request(app).post('/api/v1/auth/mfa-setup/complete')
      .send({ setupToken: body.setupToken, code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test('begin mit ungültigem Setup-Token → 401', async () => {
    const res = await request(app).post('/api/v1/auth/mfa-setup/begin').send({ setupToken: 'garbage.token.here' });
    expect(res.status).toBe(401);
  });
});

describe('MFA-Pflicht inert wenn MFA_ENABLED=false', () => {
  let app, authService;

  beforeAll(async () => {
    delete process.env.MFA_ENABLED;
    jest.resetModules();
    require('../../src/repositories/settingsRepositoryFactory')._resetInMemoryInstance();
    app         = require('../../src/app');
    authService = require('../../src/services/AuthService').authService;
    // mfaRequired=true setzen (Admin-Token; Gate ist aus, also normaler Login).
    const adminEmail = await register(authService, 'admin');
    const adminRes = await login(app, adminEmail);
    await request(app).put('/api/v1/settings/platform')
      .set('Authorization', `Bearer ${adminRes.body.token}`)
      .send({ mfaRequired: true }).expect(200);
  });

  afterAll(() => {
    if (ORIG_MFA === undefined) delete process.env.MFA_ENABLED; else process.env.MFA_ENABLED = ORIG_MFA;
    jest.resetModules();
  });

  test('mfaRequired=true aber Gate aus → normaler Session-Login (keine Erzwingung)', async () => {
    const email = await register(authService, 'analyst');
    const res = await login(app, email);
    expect(res.body.token).toBeTruthy();
    expect(res.body.mfaSetupRequired).toBeUndefined();
  });
});
