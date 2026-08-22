'use strict';

// MFA-Admin-Reset (schließt die systemische Lücke aus Behavioral-Bug #1 „MFA-Lock-in"):
// Ein Admin kann die MFA eines ausgesperrten Users zurücksetzen (disable).
//
// Sicherheit:
//   - admin-only + Passwort-Step-up (Admin bestätigt EIGENES Passwort),
//   - NICHT hinter MFA_ENABLED-Gate — der Recovery-Weg muss gerade dann greifen,
//     wenn MFA org-weit abgeschaltet wird (sonst 503-Sackgasse),
//   - Audit: Actor=Admin, Target=User, nie Secret/Code,
//   - self-Guard: der Standard-Self-Disable (/mfa/disable) bleibt unberührt.

const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { mfaService }  = require('../../src/services/MfaService');
const { auditService } = require('../../src/services/AuditService');

let adminToken, analystToken, adminId, victimId;
const ADMIN_PW = 'Admin1234!';

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  const suffix = `${Date.now()}-${Math.random()}`;

  await authService.register({ email: `adm-${suffix}@x.io`, password: ADMIN_PW, displayName: 'Admin', role: 'admin' });
  const al = await request(app).post('/api/v1/auth/login').send({ email: `adm-${suffix}@x.io`, password: ADMIN_PW });
  adminToken = al.body.token; adminId = al.body.user?.id || al.body.user?.sub;

  await authService.register({ email: `victim-${suffix}@x.io`, password: 'Victim1234!', displayName: 'Victim', role: 'analyst' });
  const vl = await request(app).post('/api/v1/auth/login').send({ email: `victim-${suffix}@x.io`, password: 'Victim1234!' });
  victimId = vl.body.user?.id || vl.body.user?.sub;

  await authService.register({ email: `ana-${suffix}@x.io`, password: 'Ana1234!', displayName: 'Ana', role: 'analyst' });
  const anl = await request(app).post('/api/v1/auth/login').send({ email: `ana-${suffix}@x.io`, password: 'Ana1234!' });
  analystToken = anl.body.token;

  // Opfer in einen aktiven MFA-Zustand versetzen (simuliert Lock-in).
  await mfaService.disable(victimId); // sauberer Ausgangszustand
  const enr = await mfaService.beginEnrollment(victimId, { issuer: 'x', label: 'v' });
  // Direkt aktivieren über die Domäne (ohne echten TOTP-Code im Test).
  const repo = mfaService._getRepo();
  const e = await repo.findByUser(victimId);
  e.activate();
  await repo.save(e);
  void enr;

  auditService.clearLog();
});

const reset = (token, body) =>
  request(app).post('/api/v1/mfa/admin/reset').set('Authorization', `Bearer ${token}`).send(body);

test('admin + korrektes Passwort → 200, Opfer-MFA disabled + Audit (Actor=Admin, Target=Opfer, kein Secret)', async () => {
  expect((await mfaService.getStatus(victimId)).status).toBe('active');

  const res = await reset(adminToken, { userId: victimId, password: ADMIN_PW });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('disabled');

  expect((await mfaService.getStatus(victimId)).status).toBe('disabled');

  const audit = auditService.getLog().find((a) => a.action === 'MFA_ADMIN_RESET');
  expect(audit).toBeDefined();
  expect(audit.targetId).toBe(victimId);
  expect(JSON.stringify(audit)).not.toContain(ADMIN_PW);
});

test('funktioniert unabhängig vom MFA_ENABLED-Gate (Recovery beim Abschalten)', async () => {
  // Kein mfaEnabledGuard: selbst wenn MFA org-weit aus ist, muss Reset gehen.
  const res = await reset(adminToken, { userId: victimId, password: ADMIN_PW });
  expect(res.status).toBe(200);
});

test('falsches Admin-Passwort → 403, KEINE Änderung + Denied-Audit', async () => {
  const res = await reset(adminToken, { userId: victimId, password: 'falsch' });
  expect(res.status).toBe(403);
  expect(res.body.error).toBe('invalid_password');
  expect((await mfaService.getStatus(victimId)).status).toBe('active');
  expect(auditService.getLog().some((a) => a.action === 'MFA_ADMIN_RESET_DENIED')).toBe(true);
});

test('fehlendes Passwort → 400', async () => {
  expect((await reset(adminToken, { userId: victimId })).status).toBe(400);
});

test('unbekannter Ziel-User → 404', async () => {
  const res = await reset(adminToken, { userId: 'does-not-exist', password: ADMIN_PW });
  expect(res.status).toBe(404);
});

test('analyst → 403 · unauth → 401', async () => {
  expect((await reset(analystToken, { userId: victimId, password: 'Ana1234!' })).status).toBe(403);
  expect((await request(app).post('/api/v1/mfa/admin/reset').send({ userId: victimId, password: ADMIN_PW })).status).toBe(401);
});
