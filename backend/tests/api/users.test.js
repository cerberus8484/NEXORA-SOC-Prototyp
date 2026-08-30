'use strict';

const request          = require('supertest');
const app              = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');

async function makeUser(role) {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.soc`;
  const user  = await authService.register({ email, displayName: role, password: 'Test1234!', role });
  const res   = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return { token: res.body.token, id: user.id, email };
}

beforeEach(() => {
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();
});

describe('GET /api/v1/users', () => {
  test('admin sieht die Benutzerliste ohne passwordHash', async () => {
    const { token } = await makeUser('admin');
    await makeUser('analyst');
    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.every((u) => u.passwordHash === undefined)).toBe(true);
  });

  test('analyst hat keinen Zugriff → 403', async () => {
    const { token } = await makeUser('analyst');
    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('ohne Token → 401', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/users/:id/role', () => {
  test('admin ändert die Rolle eines Users', async () => {
    const { token }      = await makeUser('admin');
    const { id }         = await makeUser('viewer');
    const res = await request(app)
      .patch(`/api/v1/users/${id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'analyst' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('analyst');
  });

  test('unbekannte Rolle → 400', async () => {
    const { token } = await makeUser('admin');
    const { id }    = await makeUser('viewer');
    const res = await request(app)
      .patch(`/api/v1/users/${id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
  });

  test('analyst darf keine Rolle ändern → 403', async () => {
    const { token } = await makeUser('analyst');
    const { id }    = await makeUser('viewer');
    const res = await request(app)
      .patch(`/api/v1/users/${id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/v1/users/:id/active', () => {
  test('admin deaktiviert einen User → danach Login gesperrt', async () => {
    const { token }        = await makeUser('admin');
    const { id, email }    = await makeUser('analyst');
    const res = await request(app)
      .patch(`/api/v1/users/${id}/active`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
    expect(login.status).toBe(401);
  });

  test('admin kann sich nicht selbst deaktivieren → 400', async () => {
    const { token, id } = await makeUser('admin');
    const res = await request(app)
      .patch(`/api/v1/users/${id}/active`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(res.status).toBe(400);
  });

  test('schreibt einen Audit-Eintrag', async () => {
    const { token } = await makeUser('admin');
    const { id }    = await makeUser('analyst');
    await request(app)
      .patch(`/api/v1/users/${id}/active`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(auditService.getLog().some((e) => e.action === 'USER_ACTIVE_CHANGE')).toBe(true);
  });
});

describe('POST /api/v1/users/:id/reset-password', () => {
  test('admin setzt PW zurück → 200 + tempPassword, neues PW funktioniert beim Login', async () => {
    const { token }     = await makeUser('admin');
    const { id, email } = await makeUser('analyst');

    const res = await request(app)
      .post(`/api/v1/users/${id}/reset-password`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.data.tempPassword).toBe('string');
    expect(res.body.data.tempPassword.length).toBeGreaterThanOrEqual(16);

    // Altes PW gilt nicht mehr, das neue temporäre PW funktioniert.
    const oldLogin = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/v1/auth/login').send({ email, password: res.body.data.tempPassword });
    expect(newLogin.status).toBe(200);
  });

  test('unbekannte User-ID → 404', async () => {
    const { token } = await makeUser('admin');
    const res = await request(app)
      .post('/api/v1/users/00000000-0000-0000-0000-000000000000/reset-password')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('analyst darf kein PW zurücksetzen → 403', async () => {
    const { token } = await makeUser('analyst');
    const { id }    = await makeUser('viewer');
    const res = await request(app)
      .post(`/api/v1/users/${id}/reset-password`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('ohne Token → 401', async () => {
    const { id } = await makeUser('viewer');
    const res = await request(app).post(`/api/v1/users/${id}/reset-password`);
    expect(res.status).toBe(401);
  });

  test('schreibt USER_PASSWORD_RESET Audit-Eintrag ohne PW/Hash', async () => {
    const { token } = await makeUser('admin');
    const { id }    = await makeUser('analyst');
    const res = await request(app)
      .post(`/api/v1/users/${id}/reset-password`)
      .set('Authorization', `Bearer ${token}`);

    const entry = auditService.getLog().find((e) => e.action === 'USER_PASSWORD_RESET');
    expect(entry).toBeTruthy();
    expect(entry.targetType).toBe('user');
    expect(entry.targetId).toBe(id);
    // Weder das Klartext-PW noch ein Hash dürfen im Audit-Eintrag landen.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(res.body.data.tempPassword);
    expect(serialized).not.toContain('passwordHash');
  });
});
