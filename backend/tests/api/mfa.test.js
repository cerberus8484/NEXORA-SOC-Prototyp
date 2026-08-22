'use strict';

// ── API-Tests für /api/v1/mfa (Security-Welle 3) ─────────────────────────────

const request = require('supertest');
const { totpToken } = require('../../src/mfa/totp');

const ORIGINAL_MFA_ENABLED = process.env.MFA_ENABLED;

describe('/api/v1/mfa — MFA_ENABLED=false (default inert)', () => {
  let app;

  beforeAll(() => {
    delete process.env.MFA_ENABLED;
    jest.resetModules();
    app = require('../../src/app');
  });

  afterAll(() => {
    process.env.MFA_ENABLED = ORIGINAL_MFA_ENABLED;
    jest.resetModules();
  });

  test('POST /mfa/enroll gibt 503 wenn disabled', async () => {
    const res = await request(app).post('/api/v1/mfa/enroll').set('Authorization', 'Bearer dummy');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('MFA_DISABLED');
  });

  test('GET /mfa/status gibt 503 wenn disabled', async () => {
    const res = await request(app).get('/api/v1/mfa/status').set('Authorization', 'Bearer dummy');
    expect(res.status).toBe(503);
  });
});

describe('/api/v1/mfa — MFA_ENABLED=true', () => {
  let app;
  let authService;
  let mfaService;
  let userToken, userId;

  beforeAll(() => {
    process.env.MFA_ENABLED = 'true';
    jest.resetModules();
    app         = require('../../src/app');
    authService = require('../../src/services/AuthService').authService;
    mfaService  = require('../../src/services/MfaService').mfaService;
  });

  afterAll(() => {
    process.env.MFA_ENABLED = ORIGINAL_MFA_ENABLED;
    jest.resetModules();
  });

  beforeEach(async () => {
    authService._users.clear();
    authService._blocklist.clear();
    mfaService._getRepo().clear();

    const email = `mfa-user-${Date.now()}@x.io`;
    await authService.register({ email, password: 'Test1234!', displayName: 'M', role: 'analyst' });
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
    userToken = login.body.token;
    userId    = login.body.user.id;
  });

  async function enroll() {
    return request(app).post('/api/v1/mfa/enroll').set('Authorization', `Bearer ${userToken}`);
  }

  describe('Auth-Gate', () => {
    test('401 ohne Auth', async () => {
      const res = await request(app).post('/api/v1/mfa/enroll');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /mfa/enroll', () => {
    test('201 + Secret + otpauth-URI, Status pending', async () => {
      const res = await enroll();
      expect(res.status).toBe(201);
      expect(res.body.secret).toMatch(/^[A-Z2-7]+$/);
      expect(res.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(res.body.enrollment.status).toBe('pending');
    });

    test('Response enthält KEIN secretEnc / keine Recovery-Hashes', async () => {
      const res = await enroll();
      expect(JSON.stringify(res.body.enrollment)).not.toContain('enc:v1:');
      expect(res.body.enrollment.secretEnc).toBeUndefined();
    });
  });

  describe('POST /mfa/verify', () => {
    test('200 + Recovery-Codes bei gültigem Code, danach Status active', async () => {
      const { body } = await enroll();
      const res = await request(app)
        .post('/api/v1/mfa/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: totpToken(body.secret) });
      expect(res.status).toBe(200);
      expect(res.body.recoveryCodes.length).toBeGreaterThanOrEqual(8);

      const status = await request(app).get('/api/v1/mfa/status').set('Authorization', `Bearer ${userToken}`);
      expect(status.body.status).toBe('active');
    });

    test('400 bei falschem Code, Status bleibt pending', async () => {
      await enroll();
      const res = await request(app)
        .post('/api/v1/mfa/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: '000000' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /mfa/disable', () => {
    test('200 mit gültigem Code → Status disabled', async () => {
      const { body } = await enroll();
      await request(app).post('/api/v1/mfa/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: totpToken(body.secret) });

      const res = await request(app).post('/api/v1/mfa/disable')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: totpToken(body.secret) });
      expect(res.status).toBe(200);

      const status = await request(app).get('/api/v1/mfa/status').set('Authorization', `Bearer ${userToken}`);
      expect(status.body.status).toBe('disabled');
    });

    test('400 bei aktiver MFA ohne/mit falschem Code (kein Abschalten per Session-Hijack)', async () => {
      const { body } = await enroll();
      await request(app).post('/api/v1/mfa/verify')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: totpToken(body.secret) });

      const res = await request(app).post('/api/v1/mfa/disable')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ code: '000000' });
      expect(res.status).toBe(400);

      const status = await request(app).get('/api/v1/mfa/status').set('Authorization', `Bearer ${userToken}`);
      expect(status.body.status).toBe('active');
    });
  });

  describe('GET /mfa/status', () => {
    test('none ohne Enrollment', async () => {
      const res = await request(app).get('/api/v1/mfa/status').set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('none');
    });
  });

  describe('User-Scoping', () => {
    test('enroll betrifft nur den eigenen Account', async () => {
      await enroll();
      const status = await request(app).get('/api/v1/mfa/status').set('Authorization', `Bearer ${userToken}`);
      expect(status.body.status).toBe('pending');
      // anderer User hat kein Enrollment
      const other = `mfa-other-${Date.now()}@x.io`;
      await authService.register({ email: other, password: 'Test1234!', displayName: 'O', role: 'analyst' });
      const ol = await request(app).post('/api/v1/auth/login').send({ email: other, password: 'Test1234!' });
      const oStatus = await request(app).get('/api/v1/mfa/status').set('Authorization', `Bearer ${ol.body.token}`);
      expect(oStatus.body.status).toBe('none');
    });
  });
});
