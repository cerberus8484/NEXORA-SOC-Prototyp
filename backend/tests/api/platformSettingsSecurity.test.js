'use strict';

// TDD RED-Phase: Neue Security-Keys in PUT/GET /api/v1/settings/platform
// Testet passwordMinLength, passwordComplexity, sessionMaxHours

const request      = require('supertest');
const app          = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { setMaintenance } = require('../../src/middleware/maintenanceGuard');
const { setIpAllowlist } = require('../../src/middleware/ipAllowlistGuard');
const { createSettingsRepository } = require('../../src/repositories/settingsRepositoryFactory');

let adminToken;
let analystToken;

beforeEach(async () => {
  setMaintenance(false);
  setIpAllowlist(false, ''); // globalen Guard-Cache zurücksetzen (Test-Isolation)
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();
  // Settings-Singleton zurücksetzen, damit Tests mit sauberen Defaults starten.
  const settingsRepo = createSettingsRepository();
  if (typeof settingsRepo.clear === 'function') settingsRepo.clear();

  const aEmail = `admin-sec-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'TestAdmin1!', displayName: 'Admin', role: 'admin' });
  const aRes = await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'TestAdmin1!' });
  adminToken = aRes.body.token;

  const bEmail = `analyst-sec-${Date.now()}@test.soc`;
  await authService.register({ email: bEmail, password: 'TestAnalyst1!', displayName: 'Analyst', role: 'analyst' });
  const bRes = await request(app).post('/api/v1/auth/login').send({ email: bEmail, password: 'TestAnalyst1!' });
  analystToken = bRes.body.token;
});

const asAdmin   = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${adminToken}`);
const asAnalyst = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${analystToken}`);

// ── GET: neue Keys in der Antwort ────────────────────────────────────────────

describe('GET /api/v1/settings/platform — neue Security-Keys', () => {
  test('gibt passwordMinLength mit Default 8 zurück', async () => {
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    expect(res.body.data.passwordMinLength).toBe(8);
  });

  test('gibt passwordComplexity mit Default medium zurück', async () => {
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    expect(res.body.data.passwordComplexity).toBe('medium');
  });

  test('gibt sessionMaxHours mit Default 8 zurück', async () => {
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    expect(res.body.data.sessionMaxHours).toBe(8);
  });

  test('Analyst darf die drei neuen Keys lesen (GET ist für alle Rollen)', async () => {
    const res = await asAnalyst('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    expect(res.body.data.passwordMinLength).toBeDefined();
  });
});

// ── PUT: neue Keys speichern und validieren ───────────────────────────────────

describe('PUT /api/v1/settings/platform — neue Security-Keys', () => {
  test('Admin: passwordMinLength 12 → 200 + Wert gespeichert', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordMinLength: 12 });
    expect(res.status).toBe(200);
    expect(res.body.data.passwordMinLength).toBe(12);
  });

  test('Admin: passwordComplexity high → 200 + Wert gespeichert', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordComplexity: 'high' });
    expect(res.status).toBe(200);
    expect(res.body.data.passwordComplexity).toBe('high');
  });

  test('Admin: sessionMaxHours 24 → 200 + Wert gespeichert', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ sessionMaxHours: 24 });
    expect(res.status).toBe(200);
    expect(res.body.data.sessionMaxHours).toBe(24);
  });

  test('gespeicherte Security-Keys sind beim nächsten GET sichtbar', async () => {
    await asAdmin('put', '/api/v1/settings/platform').send({
      passwordMinLength: 10,
      passwordComplexity: 'high',
      sessionMaxHours: 12,
    });
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.body.data.passwordMinLength).toBe(10);
    expect(res.body.data.passwordComplexity).toBe('high');
    expect(res.body.data.sessionMaxHours).toBe(12);
  });

  test('Analyst kann Security-Keys NICHT setzen → 403', async () => {
    const res = await asAnalyst('put', '/api/v1/settings/platform').send({ passwordMinLength: 6 });
    expect(res.status).toBe(403);
  });

  // Validierungs-Grenzfälle

  test('passwordMinLength < 8 → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordMinLength: 7 });
    expect(res.status).toBe(400);
  });

  test('passwordMinLength > 128 → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordMinLength: 129 });
    expect(res.status).toBe(400);
  });

  test('passwordMinLength = 8 → 200 (Untergrenze)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordMinLength: 8 });
    expect(res.status).toBe(200);
  });

  test('passwordMinLength = 128 → 200 (Obergrenze)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordMinLength: 128 });
    expect(res.status).toBe(200);
  });

  test('passwordComplexity ungültiger Wert → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordComplexity: 'extreme' });
    expect(res.status).toBe(400);
  });

  test('passwordComplexity low → 200', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordComplexity: 'low' });
    expect(res.status).toBe(200);
  });

  test('passwordComplexity medium → 200', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ passwordComplexity: 'medium' });
    expect(res.status).toBe(200);
  });

  test('sessionMaxHours < 1 → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ sessionMaxHours: 0 });
    expect(res.status).toBe(400);
  });

  test('sessionMaxHours > 168 → 400 (mehr als 7 Tage)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ sessionMaxHours: 169 });
    expect(res.status).toBe(400);
  });

  test('sessionMaxHours = 1 → 200 (Untergrenze)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ sessionMaxHours: 1 });
    expect(res.status).toBe(200);
  });

  test('sessionMaxHours = 168 → 200 (Obergrenze)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ sessionMaxHours: 168 });
    expect(res.status).toBe(200);
  });

  test('alle drei Keys zusammen in einem PUT → 200, alle Werte korrekt', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({
      passwordMinLength: 16,
      passwordComplexity: 'high',
      sessionMaxHours: 4,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.passwordMinLength).toBe(16);
    expect(res.body.data.passwordComplexity).toBe('high');
    expect(res.body.data.sessionMaxHours).toBe(4);
  });

  test('Audit-Eintrag enthält die geänderten Security-Keys', async () => {
    await asAdmin('put', '/api/v1/settings/platform').send({ passwordMinLength: 14 });
    const log = auditService.getLog();
    const entry = log.find((e) => e.action === 'SETTINGS_CHANGED' && e.targetId === 'platform');
    expect(entry).toBeDefined();
    expect(entry.metadata.changed.passwordMinLength).toBe(14);
  });
});

// ── ipAllowlist nur Admin — Zugriffskontroll-Felder sind admin-only ──────────
// Regression: das gesamte PUT /platform ist requireRole('admin'). Ein engineer
// (höher als analyst, aber kein admin) darf ipAllowlistCidrs NICHT setzen.
describe('ipAllowlistCidrs darf nur ein Admin setzen', () => {
  let engineerToken;

  beforeEach(async () => {
    const eEmail = `engineer-ip-${Date.now()}@test.soc`;
    await authService.register({ email: eEmail, password: 'TestEng1!', displayName: 'Eng', role: 'engineer' });
    const eRes = await request(app).post('/api/v1/auth/login').send({ email: eEmail, password: 'TestEng1!' });
    engineerToken = eRes.body.token;
  });

  const asEngineer = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${engineerToken}`);

  // Globalen ipAllowlist-Guard nach dem Admin-Erfolgsfall wieder entschärfen, damit
  // nachfolgende Tests nicht von der eigenen Test-IP ausgesperrt werden.
  afterEach(() => { setIpAllowlist(false, ''); });

  test('Engineer kann ipAllowlistCidrs NICHT setzen → 403', async () => {
    const res = await asEngineer('put', '/api/v1/settings/platform')
      .send({ ipAllowlistEnabled: true, ipAllowlistCidrs: '10.0.0.0/8' });
    expect(res.status).toBe(403);
  });

  test('Analyst kann ipAllowlistCidrs NICHT setzen → 403', async () => {
    const res = await asAnalyst('put', '/api/v1/settings/platform')
      .send({ ipAllowlistCidrs: '10.0.0.0/8' });
    expect(res.status).toBe(403);
  });

  test('Admin darf ipAllowlistCidrs setzen → 200 + Wert gespeichert', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform')
      .send({ ipAllowlistEnabled: true, ipAllowlistCidrs: '10.0.0.0/8' });
    expect(res.status).toBe(200);
    expect(res.body.data.ipAllowlistCidrs).toBe('10.0.0.0/8');
  });
});

// ── E2E: Policy greift bei neuem Login nach Session-Änderung ─────────────────

describe('sessionMaxHours wirkt beim nächsten Login', () => {
  test('Login-Token hat exp gemäß sessionMaxHours aus den Einstellungen', async () => {
    // sessionMaxHours auf 2 setzen
    await asAdmin('put', '/api/v1/settings/platform').send({ sessionMaxHours: 2 });

    // Neuen User anlegen und einloggen
    const email = `exp-test-${Date.now()}@test.soc`;
    await authService.register({ email, password: 'TestExp1!', displayName: 'E', role: 'analyst' });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password: 'TestExp1!' });
    expect(loginRes.status).toBe(200);

    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../../src/services/AuthService');
    const payload = jwt.verify(loginRes.body.token, JWT_SECRET);

    const now = Math.floor(Date.now() / 1000);
    // exp sollte ~2h in der Zukunft liegen
    expect(payload.exp).toBeGreaterThan(now + 2 * 3600 - 60);
    expect(payload.exp).toBeLessThan(now + 2 * 3600 + 60);
  });
});
