'use strict';

// TDD RED-Phase: accentColor in PUT /settings/platform
// Testet die neuen Branding-Keys: accentColor (#hex), platformName
// Ergänzt platformSettings.test.js — kein Doppel für alle Basis-Tests.

const request = require('supertest');
const app     = require('../../src/app');
const { authService }   = require('../../src/services/AuthService');
const { auditService }  = require('../../src/services/AuditService');
const { setMaintenance } = require('../../src/middleware/maintenanceGuard');

let adminToken;
let analystToken;

beforeEach(async () => {
  setMaintenance(false);
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();

  const aEmail = `admin-branding-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  const aRes = await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' });
  adminToken = aRes.body.token;

  const bEmail = `analyst-branding-${Date.now()}@test.soc`;
  await authService.register({ email: bEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  const bRes = await request(app).post('/api/v1/auth/login').send({ email: bEmail, password: 'Test1234!' });
  analystToken = bRes.body.token;
});

const asAdmin   = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${adminToken}`);
const asAnalyst = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${analystToken}`);

// ── accentColor ───────────────────────────────────────────────────────────────

describe('PUT /api/v1/settings/platform — accentColor', () => {
  it('Admin: speichert gültiges accentColor (#3b82f6) und gibt 200 zurück', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ accentColor: '#3b82f6' });
    expect(res.status).toBe(200);
    expect(res.body.data.accentColor).toBe('#3b82f6');
  });

  it('Admin: speichert Großbuchstaben-Hex (#ABC123) normiert zurück', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ accentColor: '#ABC123' });
    expect(res.status).toBe(200);
    // Groß- oder Kleinschreibung bleibt wie gesendet — Joi akzeptiert beide
    expect(res.body.data.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('Admin: gespeichertes accentColor ist beim nächsten GET sichtbar', async () => {
    await asAdmin('put', '/api/v1/settings/platform').send({ accentColor: '#ff0000' });
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.body.data.accentColor).toBe('#ff0000');
  });

  it('lehnt accentColor ohne Hash ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ accentColor: '3b82f6' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('lehnt accentColor mit 3-stelligem Hex ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ accentColor: '#abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('lehnt accentColor mit ungültigen Zeichen ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ accentColor: '#gggggg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('lehnt leeren accentColor-String ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ accentColor: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('GET liefert accentColor im Ergebnis-Objekt (PLATFORM_KEYS enthält es)', async () => {
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(res.body.data, 'accentColor')).toBe(true);
  });

  it('Analyst: darf accentColor nicht ändern → 403', async () => {
    const res = await asAnalyst('put', '/api/v1/settings/platform').send({ accentColor: '#ff0000' });
    expect(res.status).toBe(403);
  });

  it('schreibt Audit-Eintrag wenn accentColor geändert wird', async () => {
    await asAdmin('put', '/api/v1/settings/platform').send({ accentColor: '#aabbcc' });
    const log = auditService.getLog();
    const entry = log.find(e => e.action === 'SETTINGS_CHANGED' && e.targetId === 'platform');
    expect(entry).toBeDefined();
    expect(entry.metadata.changed.accentColor).toBe('#aabbcc');
  });
});

// ── Branding-Erweiterung: fontFamily + backgroundColor + sidebarColor ──────────

describe('PUT /api/v1/settings/platform — Branding-Erweiterung', () => {
  it('Admin: speichert gültige fontFamily (serif) + ist beim GET sichtbar', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ fontFamily: 'serif' });
    expect(res.status).toBe(200);
    expect(res.body.data.fontFamily).toBe('serif');
    const get = await asAdmin('get', '/api/v1/settings/platform');
    expect(get.body.data.fontFamily).toBe('serif');
  });

  it('lehnt unbekannte fontFamily ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ fontFamily: 'ComicSans' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('Admin: speichert backgroundColor + sidebarColor (Hex) und gibt sie zurück', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform')
      .send({ backgroundColor: '#101820', sidebarColor: '#0b1726' });
    expect(res.status).toBe(200);
    expect(res.body.data.backgroundColor).toBe('#101820');
    expect(res.body.data.sidebarColor).toBe('#0b1726');
  });

  it('lehnt ungültige backgroundColor (kein Hash) ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ backgroundColor: 'f8fafd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('lehnt ungültige sidebarColor (3-stellig) ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ sidebarColor: '#abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('GET enthält fontFamily/backgroundColor/sidebarColor (PLATFORM_KEYS)', async () => {
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    for (const k of ['fontFamily', 'backgroundColor', 'sidebarColor']) {
      expect(Object.prototype.hasOwnProperty.call(res.body.data, k)).toBe(true);
    }
  });

  it('Analyst: darf Branding-Erweiterung nicht ändern → 403', async () => {
    const res = await asAnalyst('put', '/api/v1/settings/platform').send({ sidebarColor: '#000000' });
    expect(res.status).toBe(403);
  });
});
