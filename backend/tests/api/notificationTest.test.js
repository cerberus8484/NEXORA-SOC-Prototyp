'use strict';

// ── API-Tests für POST /api/v1/notifications/test (Admin-Smoke-Test) ────────
// Sicherheits-Invarianten (hart):
//   - Nur admin (403 für analyst/viewer, 401 ohne Auth)
//   - Antwort enthält NUR Kanal-IDs bzw. skip-Grund — keine URLs/Creds
//   - Im Test-Default (NOTIFICATIONS_OUTBOUND_ENABLED nicht gesetzt) → skipped

const request = require('supertest');
const app     = require('../../src/app');
const { authService }         = require('../../src/services/AuthService');
const { notificationService } = require('../../src/services/NotificationService');

let adminToken, analystToken;

beforeEach(async () => {
  notificationService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();

  const ts = Date.now();

  const adminEmail = `nt-admin-${ts}@x.io`;
  await authService.register({ email: adminEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Test1234!' })).body.token;

  const analystEmail = `nt-analyst-${ts}@x.io`;
  await authService.register({ email: analystEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: analystEmail, password: 'Test1234!' })).body.token;
});

describe('POST /api/v1/notifications/test', () => {
  test('401 ohne Auth', async () => {
    const res = await request(app).post('/api/v1/notifications/test');
    expect(res.status).toBe(401);
  });

  test('403 für analyst (kein Admin)', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/test')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  test('200 für admin mit data-Ergebnisobjekt', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    // Default: Outbound aus → skipped:'disabled' (oder sent:[] bei aktivierter Konfig).
    const hasResult = 'skipped' in res.body.data || Array.isArray(res.body.data.sent);
    expect(hasResult).toBe(true);
  });

  test('SECRET-LEAK: Antwort enthält keine URL/SMTP/Secret', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/test')
      .set('Authorization', `Bearer ${adminToken}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toMatch(/smtp/i);
    expect(body).not.toMatch(/secret/i);
    expect(body).not.toMatch(/token/i);
    expect(body).not.toMatch(/pass/i);
  });

  test('requestId vorhanden', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.requestId).toBeDefined();
  });
});
