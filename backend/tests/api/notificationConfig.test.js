'use strict';

// Layer 2: Outbound-Benachrichtigungen aus der UI verwalten.
//
// GET /api/v1/notifications/config — maskierte Editier-Sicht (admin; nie Passwort/URL)
// PUT /api/v1/notifications/config — speichern (admin, verschlüsselt, + Audit)
//
// /channels bleibt booleans-only, spiegelt aber jetzt den DB>ENV-Stand.

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { NOTIFICATION_SETTINGS_KEY } = require('../../src/services/notificationSettings');
const { isEncrypted } = require('../../src/config/secretsCrypto');

let adminToken, analystToken;

async function tokenFor(role, suffix) {
  const email = `ncfg-${role}-${suffix}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  const suffix = `${Date.now()}-${Math.random()}`;
  adminToken   = await tokenFor('admin', suffix);
  analystToken = await tokenFor('analyst', suffix);
  await createSettingsRepository().set(NOTIFICATION_SETTINGS_KEY, {});
  auditService.clearLog();
});

// WICHTIG: Der InMemory-Settings-Store ist ein prozessweiter Singleton. deliverOutbound
// löst die Notify-Config per Default daraus auf → hinterlassene Webhook-URLs/enabled
// würden andere Notify-Suiten im selben `--runInBand`-Prozess echte Sends versuchen
// lassen (5s-Timeout ohne Egress → Jest-Timeout). Nach der Suite sauber zurücksetzen.
afterAll(async () => {
  await createSettingsRepository().set(NOTIFICATION_SETTINGS_KEY, {});
});

const getCfg = (token) => {
  const req = request(app).get('/api/v1/notifications/config');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const putCfg = (token, body) =>
  request(app).put('/api/v1/notifications/config').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/notifications/config', () => {
  test('admin → 200, maskierte Struktur (email + channels), NIE Passwort/URL', async () => {
    const res = await getCfg(adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('outboundEnabled');
    expect(res.body.data.email).toHaveProperty('passwordSet');
    expect(res.body.data.email).not.toHaveProperty('pass');
    expect(Array.isArray(res.body.data.channels)).toBe(true);
    // Channels tragen nur urlSet, nie die URL.
    for (const ch of res.body.data.channels) {
      expect(ch).not.toHaveProperty('url');
      expect(typeof ch.urlSet).toBe('boolean');
    }
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await getCfg(analystToken)).status).toBe(403);
    expect((await getCfg(null)).status).toBe(401);
  });
});

describe('PUT /api/v1/notifications/config', () => {
  test('admin → 200, SMTP-Passwort verschlüsselt gespeichert, Audit ohne Secret', async () => {
    const res = await putCfg(adminToken, {
      outboundEnabled: true,
      email: { host: 'mail.intern', port: 587, secure: false, user: 'svc', pass: 'smtp-geheim', from: 'soc@intern', to: 'team@intern' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.email.passwordSet).toBe(true);
    expect(res.body.data.email.source).toBe('db');

    const stored = await createSettingsRepository().get(NOTIFICATION_SETTINGS_KEY);
    expect(isEncrypted(stored.email.pass)).toBe(true);

    const audit = auditService.getLog().find((e) => e.action === 'NOTIFY_SETTINGS_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('smtp-geheim');
  });

  test('Webhook-URL wird verschlüsselt gespeichert und nie zurückgegeben', async () => {
    const res = await putCfg(adminToken, { slackWebhookUrl: 'https://hooks.slack.com/services/T/B/secret' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    const stored = await createSettingsRepository().get(NOTIFICATION_SETTINGS_KEY);
    expect(isEncrypted(stored.slackWebhookUrl)).toBe(true);
  });

  test('ungültiger SMTP-Port → 400, nichts gespeichert', async () => {
    const res = await putCfg(adminToken, { email: { host: 'mail.x', port: 70000, secure: false, user: '', pass: '', from: '', to: '' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    const stored = await createSettingsRepository().get(NOTIFICATION_SETTINGS_KEY);
    expect(stored.email).toBeUndefined();
  });

  test('Webhook-URL mit unerlaubtem Schema (file:) → 400', async () => {
    const res = await putCfg(adminToken, { slackWebhookUrl: 'file:///etc/passwd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('gültige https-Webhook-URL + gültiger Port → 200', async () => {
    const res = await putCfg(adminToken, {
      email: { host: 'mail.x', port: 587, secure: false, user: 'u', pass: 'p', from: 'a@x', to: 'b@x' },
      slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x',
    });
    expect(res.status).toBe(200);
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putCfg(analystToken, { outboundEnabled: true })).status).toBe(403);
    expect((await request(app).put('/api/v1/notifications/config').send({ outboundEnabled: true })).status).toBe(401);
  });
});

describe('GET /api/v1/notifications/channels spiegelt DB', () => {
  test('nach PUT mit Slack-URL → channel slack.configured=true, weiterhin booleans-only (kein Leak)', async () => {
    await putCfg(adminToken, { slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x' });
    const res = await request(app).get('/api/v1/notifications/channels').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const slack = res.body.channels.find((c) => c.id === 'slack');
    expect(slack.configured).toBe(true);
    // Weiterhin kein Secret/URL im Body.
    expect(JSON.stringify(res.body)).not.toMatch(/https?:\/\//);
  });
});
