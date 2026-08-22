'use strict';

// Layer 2: Inbound-Webhook-Secrets aus der UI verwalten (admin + Audit) UND der
// Webhook-Handler honoriert das DB-Secret (DB > ENV), damit eine Rotation sofort greift.

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');
const { WEBHOOK_SECRETS_KEY, saveWebhookSecret } = require('../../src/services/webhookSecretsSettings');
const { signWebhook } = require('../../src/integrations/hmac');
const { isEncrypted } = require('../../src/config/secretsCrypto');

let adminToken, analystToken;
const ADMIN_PW = 'Test1234!';
const ENV_KEYS = ['WEBHOOK_SECRET_WAZUH', 'WEBHOOK_SECRET_QRADAR', 'WEBHOOK_SECRET_SPLUNK', 'WEBHOOK_SECRET_DATAPLANE', 'WEBHOOK_SECRET_GENERIC'];
const savedEnv = {};

async function tokenFor(role, suffix) {
  const email = `wh-${role}-${suffix}@x.io`;
  await authService.register({ email, password: ADMIN_PW, displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: ADMIN_PW });
  return res.body.token;
}

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  const suffix = `${Date.now()}-${Math.random()}`;
  adminToken   = await tokenFor('admin', suffix);
  analystToken = await tokenFor('analyst', suffix);
  await createSettingsRepository().set(WEBHOOK_SECRETS_KEY, {});
  auditService.clearLog();
  ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; delete process.env[k]; });
});

afterEach(() => {
  ENV_KEYS.forEach((k) => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; });
});

const getSecrets = (token) => {
  const req = request(app).get('/api/v1/settings/webhook-secrets');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const putSecret = (token, body) =>
  request(app).put('/api/v1/settings/webhook-secrets').set('Authorization', `Bearer ${token}`).send(body);

describe('GET /api/v1/settings/webhook-secrets', () => {
  test('admin → 200, je Quelle set+origin, NIE ein Secret', async () => {
    const res = await getSecrets(adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toHaveProperty('set');
    expect(res.body.data[0]).toHaveProperty('origin');
    expect(JSON.stringify(res.body.data)).not.toMatch(/secret|enc:v1:/i);
  });
  test('analyst → 403 · unauth → 401', async () => {
    expect((await getSecrets(analystToken)).status).toBe(403);
    expect((await getSecrets(null)).status).toBe(401);
  });
});

describe('PUT /api/v1/settings/webhook-secrets', () => {
  test('admin setzt wazuh-Secret → 200, verschlüsselt, Audit ohne Wert', async () => {
    const res = await putSecret(adminToken, { source: 'wazuh', secret: 'mein-hmac-secret' });
    expect(res.status).toBe(200);
    expect(res.body.data.find((m) => m.source === 'wazuh')).toMatchObject({ set: true, origin: 'db' });
    const stored = await createSettingsRepository().get(WEBHOOK_SECRETS_KEY);
    expect(isEncrypted(stored.wazuh)).toBe(true);
    const audit = auditService.getLog().find((e) => e.action === 'WEBHOOK_SECRETS_CHANGED');
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit.metadata)).not.toContain('mein-hmac-secret');
    expect(audit.metadata).toMatchObject({ source: 'wazuh', set: true });
  });

  test('unbekannte Quelle → 400 (INVALID_SOURCE)', async () => {
    const res = await putSecret(adminToken, { source: 'nope', secret: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SOURCE');
  });

  test('analyst → 403 · unauth → 401', async () => {
    expect((await putSecret(analystToken, { source: 'wazuh', secret: 'x' })).status).toBe(403);
    expect((await request(app).put('/api/v1/settings/webhook-secrets').send({ source: 'wazuh', secret: 'x' })).status).toBe(401);
  });
});

describe('Webhook-Handler honoriert das DB-Secret (DB > ENV)', () => {
  async function postSigned(source, secret, body) {
    const rawBody   = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhook(secret, timestamp, rawBody);
    return request(app)
      .post(`/api/v1/integrations/${source}/webhook`)
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signature)
      .set('X-Webhook-Timestamp', timestamp)
      .send(body);
  }

  test('korrekt mit DB-Secret signiert → NICHT 401 (HMAC bestanden)', async () => {
    await saveWebhookSecret(createSettingsRepository(), 'generic', 'db-only-secret');
    const res = await postSigned('generic', 'db-only-secret', { test: true, message: 'ping' });
    expect(res.status).not.toBe(401);
  });

  test('falsches Secret → 401', async () => {
    await saveWebhookSecret(createSettingsRepository(), 'generic', 'db-only-secret');
    const res = await postSigned('generic', 'falsches-secret', { test: true });
    expect(res.status).toBe(401);
  });
});
