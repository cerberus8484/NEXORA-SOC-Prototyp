'use strict';

// ── TDD RED: API-Tests für GET /api/v1/notifications/channels ───────────────
// Sicherheits-Invarianten (hart):
//   - Nur admin darf zugreifen (403 für analyst/viewer)
//   - Response enthält NUR Boolean-Felder — keine URLs, keine Secrets
//   - outboundEnabled ist Boolean
//   - channels[].configured ist Boolean

const request = require('supertest');
const app     = require('../../src/app');
const { authService }         = require('../../src/services/AuthService');
const { notificationService } = require('../../src/services/NotificationService');

let adminToken, analystToken, viewerToken;

beforeEach(async () => {
  notificationService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();

  const ts = Date.now();

  // Admin
  const adminEmail = `chan-admin-${ts}@x.io`;
  await authService.register({ email: adminEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Test1234!' });
  adminToken = adminLogin.body.token;

  // Analyst
  const analystEmail = `chan-analyst-${ts}@x.io`;
  await authService.register({ email: analystEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  const analystLogin = await request(app).post('/api/v1/auth/login').send({ email: analystEmail, password: 'Test1234!' });
  analystToken = analystLogin.body.token;

  // Viewer
  const viewerEmail = `chan-viewer-${ts}@x.io`;
  await authService.register({ email: viewerEmail, password: 'Test1234!', displayName: 'Viewer', role: 'viewer' });
  const viewerLogin = await request(app).post('/api/v1/auth/login').send({ email: viewerEmail, password: 'Test1234!' });
  viewerToken = viewerLogin.body.token;
});

describe('GET /api/v1/notifications/channels', () => {

  test('401 ohne Auth', async () => {
    const res = await request(app).get('/api/v1/notifications/channels');
    expect(res.status).toBe(401);
  });

  test('403 für analyst (kein Admin)', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  test('403 für viewer (kein Admin)', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  test('200 für admin', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  test('gibt outboundEnabled als Boolean zurück', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(typeof res.body.outboundEnabled).toBe('boolean');
  });

  test('gibt channels-Array zurück', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(Array.isArray(res.body.channels)).toBe(true);
    expect(res.body.channels.length).toBeGreaterThan(0);
  });

  test('jeder channel hat id (string) und configured (boolean)', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${adminToken}`);

    for (const ch of res.body.channels) {
      expect(typeof ch.id).toBe('string');
      expect(typeof ch.configured).toBe('boolean');
    }
  });

  test('channels enthält slack und webhook', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${adminToken}`);

    const ids = res.body.channels.map((c) => c.id);
    expect(ids).toContain('slack');
    expect(ids).toContain('webhook');
  });

  test('channels enthält teams und email', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${adminToken}`);

    const ids = res.body.channels.map((c) => c.id);
    expect(ids).toContain('teams');
    expect(ids).toContain('email');
  });

  // ── KRITISCH: Secret-Leak-Test ─────────────────────────────────────────────
  // Die Antwort darf niemals eine URL oder ein Secret enthalten.

  test('SECRET-LEAK: Response enthält keine Webhook-URL (nur Booleans)', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${adminToken}`);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/https?:\/\//);          // keine http(s)-URL
    expect(body).not.toMatch(/NOTIFY_SLACK/);         // kein ENV-Name
    expect(body).not.toMatch(/NOTIFY_WEBHOOK/);       // kein ENV-Name
    expect(body).not.toMatch(/slackWebhookUrl/i);     // kein internes Feld
    expect(body).not.toMatch(/genericWebhookUrl/i);   // kein internes Feld
    expect(body).not.toMatch(/NOTIFY_SMTP/);          // kein SMTP-ENV-Name
    expect(body).not.toMatch(/smtp/i);                // keine SMTP-Hosts/Creds
    expect(body).not.toMatch(/secret/i);              // kein Secret
    expect(body).not.toMatch(/token/i);               // kein Token
  });

  test('requestId ist vorhanden', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/channels')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.requestId).toBeDefined();
  });
});
