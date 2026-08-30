'use strict';

// OIDC In-UI-Admin (P1 #6) — Settings-API.
// GET  /api/v1/settings/oidc       — admin; maskiert (kein Secret)
// PUT  /api/v1/settings/oidc       — admin; Joi + Audit; Secret verschlüsselt at-rest
// POST /api/v1/settings/oidc/test  — admin; Discovery-Probe (hier ohne Netz: https-Guard)

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { settingsRepo } = require('../../src/auth/oidc/oidcInstance');

const OIDC_KEYS = ['oidc_enabled', 'oidc_issuer', 'oidc_clientId', 'oidc_clientSecret',
  'oidc_redirectUri', 'oidc_scope', 'oidc_defaultRole', 'oidc_allowSignup'];

let adminToken;
let viewerToken;

beforeEach(async () => {
  // Geteilten Settings-Singleton auf leeren Stand setzen (kein Test-Leak).
  for (const k of OIDC_KEYS) {
    await settingsRepo.set(k, k === 'oidc_enabled' || k === 'oidc_allowSignup' ? false : '');
  }
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();

  const aEmail = `admin-oidc-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' })).body.token;

  const vEmail = `viewer-oidc-${Date.now()}@test.soc`;
  await authService.register({ email: vEmail, password: 'Test1234!', displayName: 'Viewer', role: 'viewer' });
  viewerToken = (await request(app).post('/api/v1/auth/login').send({ email: vEmail, password: 'Test1234!' })).body.token;
});

const asAdmin = (m, u) => request(app)[m](u).set('Authorization', `Bearer ${adminToken}`);
const asViewer = (m, u) => request(app)[m](u).set('Authorization', `Bearer ${viewerToken}`);

describe('GET /api/v1/settings/oidc — RBAC + Maskierung', () => {
  it('401 ohne Token', async () => {
    expect((await request(app).get('/api/v1/settings/oidc')).status).toBe(401);
  });

  it('403 für non-admin (viewer)', async () => {
    expect((await asViewer('get', '/api/v1/settings/oidc')).status).toBe(403);
  });

  it('200 für admin, OHNE Secret-Feld', async () => {
    const res = await asAdmin('get', '/api/v1/settings/oidc');
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('clientSecret');
    expect(res.body.data).toHaveProperty('clientSecretSet');
    expect(res.body.data).toHaveProperty('configured');
  });
});

describe('PUT /api/v1/settings/oidc — Validierung + Persistenz', () => {
  it('403 für non-admin', async () => {
    expect((await asViewer('put', '/api/v1/settings/oidc').send({ issuer: 'https://idp/x' })).status).toBe(403);
  });

  it('400 bei http-Issuer (nur https erlaubt)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/oidc').send({ issuer: 'http://idp/x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  // Step-up-Reauth (Parität zu den Connector-Configs): OIDC steuert die Auth der ganzen
  // Plattform → eine Config-Änderung erfordert die Online-Passwortbestätigung des Admins.
  const PW = 'Test1234!';

  it('403 ohne Passwort (Step-up erforderlich), auch als Admin', async () => {
    const res = await asAdmin('put', '/api/v1/settings/oidc').send({ clientId: 'soc-app' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('invalid_password');
  });

  it('403 bei falschem Passwort', async () => {
    const res = await asAdmin('put', '/api/v1/settings/oidc').send({ clientId: 'soc-app', password: 'wrong-pw' });
    expect(res.status).toBe(403);
  });

  it('400 OIDC_INCOMPLETE beim Aktivieren ohne vollständige Config', async () => {
    const res = await asAdmin('put', '/api/v1/settings/oidc').send({ enabled: true, password: PW });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OIDC_INCOMPLETE');
  });

  it('200 speichert gültigen Patch (mit Step-up); Secret kommt NIE zurück', async () => {
    const res = await asAdmin('put', '/api/v1/settings/oidc').send({
      issuer: 'https://idp.example/realms/soc', clientId: 'soc-app',
      clientSecret: 'super-secret-value', defaultRole: 'viewer', password: PW,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.issuer).toBe('https://idp.example/realms/soc');
    expect(res.body.data.clientSecretSet).toBe(true);
    expect(res.body.data.configured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-value');
  });

  it('Audit-Log enthält weder Secret- NOCH Step-up-Passwort-Wert', async () => {
    await asAdmin('put', '/api/v1/settings/oidc').send({ clientSecret: 'leak-check-secret', password: PW });
    const entries = auditService.getLog ? await auditService.getLog() : [];
    const dump = JSON.stringify(entries);
    expect(dump).not.toContain('leak-check-secret');
    expect(dump).not.toContain(PW);
  });

  it('aktivieren gelingt, sobald Issuer+ClientId+Secret gesetzt sind', async () => {
    await asAdmin('put', '/api/v1/settings/oidc').send({ issuer: 'https://idp/x', clientId: 'c', clientSecret: 's', password: PW });
    const res = await asAdmin('put', '/api/v1/settings/oidc').send({ enabled: true, password: PW });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
  });
});

describe('POST /api/v1/settings/oidc/test — https-Guard (ohne Netz)', () => {
  it('ok=false bei nicht-https Issuer', async () => {
    const res = await asAdmin('post', '/api/v1/settings/oidc/test').send({ issuer: 'http://idp/x' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
  });

  it('403 für non-admin', async () => {
    expect((await asViewer('post', '/api/v1/settings/oidc/test').send({ issuer: 'https://idp/x' })).status).toBe(403);
  });

  // Info-Disclosure-Härtung: ein fehlgeschlagener Discovery-Probe darf nie den rohen
  // Fehler (Host/Port/Code) spiegeln — nur eine whitelistete Kategorie.
  it('leakt bei Verbindungsfehler keinen rohen Fehler (Host/Port/Code)', async () => {
    // Port 9 (discard) lokal geschlossen → ECONNREFUSED, deterministisch.
    const res = await asAdmin('post', '/api/v1/settings/oidc/test').send({ issuer: 'https://127.0.0.1:9' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(typeof res.body.data.error).toBe('string');
    expect(res.body.data.error.length).toBeGreaterThan(0);
    // Kein rohes Detail im Client-sichtbaren Fehler.
    const dump = JSON.stringify(res.body);
    expect(dump).not.toMatch(/ECONNREFUSED|ENOTFOUND|127\.0\.0\.1|:9\b/);
  });
});
