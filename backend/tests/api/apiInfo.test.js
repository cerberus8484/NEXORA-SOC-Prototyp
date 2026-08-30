'use strict';

/**
 * Integrations-Test für GET /api/v1/integrations/api-info
 *
 * TDD (RED zuerst): Tests schreiben, bevor die Route implementiert ist.
 *
 * SICHERHEITSINVARIANTE:
 *   - Nur admin darf die Route aufrufen (analyst/viewer → 403).
 *   - Response enthält NIEMALS Secret-Werte (nur hmacConfigured: boolean).
 */

const request         = require('supertest');
const app             = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let adminToken;
let analystToken;
let viewerToken;

beforeAll(async () => {
  const ts = Date.now();
  const adminEmail   = `api-info-admin-${ts}@x.test`;
  const analystEmail = `api-info-analyst-${ts}@x.test`;
  const viewerEmail  = `api-info-viewer-${ts}@x.test`;

  await authService.register({ email: adminEmail,   password: 'Admin1234!',  displayName: 'Admin',   role: 'admin' });
  await authService.register({ email: analystEmail, password: 'Test1234!',   displayName: 'Analyst', role: 'analyst' });
  await authService.register({ email: viewerEmail,  password: 'Test1234!',   displayName: 'Viewer',  role: 'viewer' });

  adminToken   = (await request(app).post('/api/v1/auth/login').send({ email: adminEmail,   password: 'Admin1234!' })).body.token;
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: analystEmail, password: 'Test1234!' })).body.token;
  viewerToken  = (await request(app).post('/api/v1/auth/login').send({ email: viewerEmail,  password: 'Test1234!' })).body.token;
});

// ── Auth-Schutz ───────────────────────────────────────────────────────────────

describe('GET /api/v1/integrations/api-info — Auth-Schutz', () => {
  it('ohne Token → 401', async () => {
    const res = await request(app).get('/api/v1/integrations/api-info');
    expect(res.status).toBe(401);
  });

  it('analyst → 403', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/api-info')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  it('viewer → 403', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/api-info')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('admin → 200', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/api-info')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

// ── Response-Struktur ─────────────────────────────────────────────────────────

describe('GET /api/v1/integrations/api-info — Response-Struktur', () => {
  let body;

  beforeAll(async () => {
    const res = await request(app)
      .get('/api/v1/integrations/api-info')
      .set('Authorization', `Bearer ${adminToken}`);
    body = res.body;
  });

  it('enthält rateLimit', () => {
    expect(body).toHaveProperty('rateLimit');
  });

  it('rateLimit enthält max, windowMs, webhookMax als Zahlen', () => {
    expect(typeof body.rateLimit.max).toBe('number');
    expect(typeof body.rateLimit.windowMs).toBe('number');
    expect(typeof body.rateLimit.webhookMax).toBe('number');
  });

  it('enthält webhookReceivers als Array', () => {
    expect(Array.isArray(body.webhookReceivers)).toBe(true);
    expect(body.webhookReceivers.length).toBeGreaterThan(0);
  });

  it('jeder Receiver hat source, path, hmacConfigured', () => {
    for (const receiver of body.webhookReceivers) {
      expect(typeof receiver.source).toBe('string');
      expect(typeof receiver.path).toBe('string');
      expect(typeof receiver.hmacConfigured).toBe('boolean');
    }
  });

  it('path je Receiver endet auf /webhook und enthält die source', () => {
    for (const receiver of body.webhookReceivers) {
      expect(receiver.path).toContain(receiver.source);
      expect(receiver.path).toMatch(/\/webhook$/);
    }
  });

  it('hat requestId', () => {
    expect(body).toHaveProperty('requestId');
  });
});

// ── SECRET-LEAK-SCHUTZ ────────────────────────────────────────────────────────
// KRITISCH: Diese Tests müssen IMMER grün bleiben.
// Keine ENV mit echten Secrets nötig — leere ENV reicht für den Strukturtest.

describe('GET /api/v1/integrations/api-info — SECRET-LEAK-SCHUTZ', () => {
  it('Response enthält keine Felder mit Secret-Namen', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/api-info')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const json = JSON.stringify(res.body);

    // Kein JSON-Key wie "secret", "password", "token", "key" darf auftauchen
    const FORBIDDEN_KEYS = ['secret', 'password', 'apiKey', 'api_key', 'hmacSecret', 'hmacKey'];
    for (const key of FORBIDDEN_KEYS) {
      // Prüft ob das Feld als JSON-Key auftaucht: "secret":
      expect(json).not.toMatch(new RegExp(`"${key}"\\s*:`));
    }
  });

  it('hmacConfigured ist in jedem Receiver ein boolean — kein string/null/object', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/api-info')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    for (const receiver of res.body.webhookReceivers) {
      expect(receiver.hmacConfigured === true || receiver.hmacConfigured === false).toBe(true);
    }
  });

  it('Receiver-Objekte haben exakt die erlaubten Felder (source, path, hmacConfigured)', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/api-info')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const ALLOWED_FIELDS = new Set(['source', 'path', 'hmacConfigured']);
    for (const receiver of res.body.webhookReceivers) {
      for (const key of Object.keys(receiver)) {
        expect(ALLOWED_FIELDS.has(key)).toBe(true);
      }
    }
  });
});
