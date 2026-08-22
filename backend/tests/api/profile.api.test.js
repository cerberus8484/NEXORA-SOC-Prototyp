'use strict';

// TDD RED: GET/PUT /v1/profile — Auth, Felder, Security, Audit.
const request          = require('supertest');
const app              = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');

async function makeUser(role = 'analyst', extra = {}) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@soc.test`;
  const user  = await authService.register({
    email,
    displayName: 'Test User',
    password: 'Test1234!',
    role,
    ...extra,
  });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return { token: res.body.token, id: user.id, email, user };
}

beforeEach(() => {
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();
});

// ── GET /api/v1/profile ──────────────────────────────────────────────────────

describe('GET /api/v1/profile', () => {
  test('gibt eigenes User-Objekt zurück (inkl. phone/theme, ohne passwordHash)', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.email).toBeDefined();
    expect(res.body.data).toHaveProperty('phone');
    expect(res.body.data).toHaveProperty('theme');
  });

  test('ohne Token → 401', async () => {
    const res = await request(app).get('/api/v1/profile');
    expect(res.status).toBe(401);
  });

  test('gibt NUR das eigene Profil zurück (sub-basiert)', async () => {
    const { token, email } = await makeUser('analyst');
    const res = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.email).toBe(email);
  });

  test('liefert per-User-Feature-Flags (MFA/PAT) als Booleans — auch für Nicht-Admins', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${token}`);
    expect(res.body.features).toBeDefined();
    expect(typeof res.body.features.mfaEnabled).toBe('boolean');
    expect(typeof res.body.features.apiTokensEnabled).toBe('boolean');
  });
});

// ── PUT /api/v1/profile ──────────────────────────────────────────────────────

describe('PUT /api/v1/profile', () => {
  test('ändert displayName, phone, theme (happy path)', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Alice Smith', phone: '+49 123', theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Alice Smith');
    expect(res.body.data.phone).toBe('+49 123');
    expect(res.body.data.theme).toBe('dark');
  });

  test('persistiert: GET /profile danach liefert neue Werte', async () => {
    const { token } = await makeUser('analyst');
    await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Persisted Name', phone: '+49 777', theme: 'light' });
    const get = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${token}`);
    expect(get.body.data.displayName).toBe('Persisted Name');
    expect(get.body.data.phone).toBe('+49 777');
    expect(get.body.data.theme).toBe('light');
  });

  test('ändert language + dateFormat (happy path) und persistiert', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'en', dateFormat: 'iso' });
    expect(res.status).toBe(200);
    expect(res.body.data.language).toBe('en');
    expect(res.body.data.dateFormat).toBe('iso');

    const get = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${token}`);
    expect(get.body.data.language).toBe('en');
    expect(get.body.data.dateFormat).toBe('iso');
  });

  test('GET liefert language/dateFormat Defaults (en/dmy)', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app).get('/api/v1/profile').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.language).toBe('en');
    expect(res.body.data.dateFormat).toBe('dmy');
  });

  test('ungültiges language → 400', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ language: 'fr' });
    expect(res.status).toBe(400);
  });

  test('ungültiges dateFormat → 400', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ dateFormat: 'mdy' });
    expect(res.status).toBe(400);
  });

  test('ohne Token → 401', async () => {
    const res = await request(app).put('/api/v1/profile').send({ displayName: 'X' });
    expect(res.status).toBe(401);
  });

  test('ungültiges theme → 400', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'rainbow' });
    expect(res.status).toBe(400);
  });

  test('displayName zu lang → 400', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'A'.repeat(201) });
    expect(res.status).toBe(400);
  });

  test('phone zu lang → 400', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+49 ' + '9'.repeat(100) });
    expect(res.status).toBe(400);
  });

  // ── Security: role/email/isActive dürfen NICHT geändert werden ──────────

  test('role im Body wird ignoriert — role bleibt analyst', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'X', role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('analyst');
  });

  test('email im Body wird ignoriert — email unverändert', async () => {
    const { token, email } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'X', email: 'hacked@evil.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(email);
  });

  test('isActive im Body wird ignoriert — isActive bleibt true', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'X', isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
  });

  test('passwordHash im Body wird ignoriert', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'X', passwordHash: 'evil-hash' });
    expect(res.status).toBe(200);
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  // ── Audit ────────────────────────────────────────────────────────────────

  test('schreibt PROFILE_UPDATED Audit-Eintrag', async () => {
    const { token } = await makeUser('analyst');
    await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Audit Test', phone: '', theme: '' });
    const log = auditService.getLog();
    expect(log.some((e) => e.action === 'PROFILE_UPDATED')).toBe(true);
  });

  // ── Leeres Body / partial update ─────────────────────────────────────────

  test('leerer Body → 200 (keine Änderung, kein Fehler)', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app)
      .put('/api/v1/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
  });
});
