'use strict';

// Serverseitige Durchsetzung des Erst-Login-Passwortzwangs (Security-Fix C-1):
// solange `mustChangePassword` gilt, sind ALLE Endpunkte gesperrt außer
// Passwort-Wechsel/Logout/Me — sonst Client-only-Bypass mit gültigem JWT.

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

async function bootstrapAdminToken() {
  await authService.ensureAdminUser({ email: 'mcp-enforce@test.soc', password: 'Test1234!' });
  const login = await request(app).post('/api/v1/auth/login')
    .send({ email: 'mcp-enforce@test.soc', password: 'Test1234!' });
  return login.body.token;
}

beforeEach(() => {
  authService._users.clear();
  if (authService._blocklist && authService._blocklist.clear) authService._blocklist.clear();
});

describe('Erst-Login-Passwortzwang — serverseitig', () => {
  it('blockt normale Endpunkte mit 403, solange der Wechsel aussteht', async () => {
    const token = await bootstrapAdminToken();
    const res = await request(app).get('/api/v1/tickets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('lässt /auth/me trotz Zwang zu (Ausnahme)', async () => {
    const token = await bootstrapAdminToken();
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200); // /me ist trotz Zwang erreichbar (Ausnahme)
  });

  it('nach erfolgreichem Passwortwechsel sind Endpunkte wieder frei', async () => {
    const token = await bootstrapAdminToken();
    const ch = await request(app).post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Test1234!', newPassword: 'Test9999!' });
    expect(ch.status).toBe(200);
    const res = await request(app).get('/api/v1/tickets').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('normaler User ohne Flag ist NICHT gesperrt', async () => {
    await authService.register({ email: 'normal@test.soc', password: 'Test1234!', displayName: 'N', role: 'analyst' });
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'normal@test.soc', password: 'Test1234!' });
    const res = await request(app).get('/api/v1/tickets').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
  });
});
