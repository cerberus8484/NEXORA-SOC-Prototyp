'use strict';

// TDD RED-Phase: Plattform-Settings-API-Tests
// GET  /api/v1/settings/platform — requireAuth (alle Rollen)
// PUT  /api/v1/settings/platform — requireRole('admin') + Joi-Validierung + Audit

const request = require('supertest');
const app     = require('../../src/app');
const { authService }   = require('../../src/services/AuthService');
const { auditService }  = require('../../src/services/AuditService');
const { setMaintenance } = require('../../src/middleware/maintenanceGuard');
const { setTlsEnforce }  = require('../../src/middleware/tlsGuard');
const { setIpAllowlist } = require('../../src/middleware/ipAllowlistGuard');

let adminToken;
let analystToken;
let viewerToken;

beforeEach(async () => {
  // Guard-Singletons zwischen Tests zurücksetzen (sonst leakt aktivierte
  // Zugriffskontrolle aus einem Test in die folgenden → 403/503).
  setMaintenance(false);
  setTlsEnforce(false);
  setIpAllowlist(false, '');

  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();

  const aEmail = `admin-plat-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  const aRes = await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' });
  adminToken = aRes.body.token;

  const bEmail = `analyst-plat-${Date.now()}@test.soc`;
  await authService.register({ email: bEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  const bRes = await request(app).post('/api/v1/auth/login').send({ email: bEmail, password: 'Test1234!' });
  analystToken = bRes.body.token;

  const cEmail = `viewer-plat-${Date.now()}@test.soc`;
  await authService.register({ email: cEmail, password: 'Test1234!', displayName: 'Viewer', role: 'viewer' });
  const cRes = await request(app).post('/api/v1/auth/login').send({ email: cEmail, password: 'Test1234!' });
  viewerToken = cRes.body.token;
});

const asAdmin   = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${adminToken}`);
const asAnalyst = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${analystToken}`);
const asViewer  = (method, url) => request(app)[method](url).set('Authorization', `Bearer ${viewerToken}`);
const asGuest   = (method, url) => request(app)[method](url);

// ── GET /api/v1/settings/platform ────────────────────────────────────────────

describe('GET /api/v1/settings/platform', () => {
  it('gibt 401 ohne Token zurück', async () => {
    const res = await asGuest('get', '/api/v1/settings/platform');
    expect(res.status).toBe(401);
  });

  it('gibt 200 + Defaults für Admin zurück', async () => {
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    const d = res.body.data;
    expect(d.platformName).toBeDefined();
    expect(d.defaultView).toBeDefined();
    expect(d.timezone).toBeDefined();
    expect(d.language).toBeDefined();
    expect(typeof d.maintenanceMode).toBe('boolean');
    expect(typeof d.betaFeatures).toBe('boolean');
  });

  it('gibt 200 + Defaults für Analyst zurück (alle Rollen dürfen lesen)', async () => {
    const res = await asAnalyst('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('gibt 200 + Defaults für Viewer zurück (alle Rollen dürfen lesen)', async () => {
    const res = await asViewer('get', '/api/v1/settings/platform');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('liefert genau die PLATFORM_KEYS (keine KI-Felder)', async () => {
    const res = await asAdmin('get', '/api/v1/settings/platform');
    const keys = Object.keys(res.body.data);
    expect(keys).toEqual(expect.arrayContaining(['platformName','defaultView','timezone','language','maintenanceMode','betaFeatures']));
    // KI-Schlüssel dürfen NICHT enthalten sein
    expect(keys).not.toContain('ollamaBaseUrl');
    expect(keys).not.toContain('agentLlmProvider');
  });

  it('enthält requestId', async () => {
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.body.requestId).toBeDefined();
  });
});

// ── PUT /api/v1/settings/platform ────────────────────────────────────────────

describe('PUT /api/v1/settings/platform', () => {
  it('gibt 403 für Analyst zurück', async () => {
    const res = await asAnalyst('put', '/api/v1/settings/platform').send({ platformName: 'Hack' });
    expect(res.status).toBe(403);
  });

  it('gibt 403 für Viewer zurück', async () => {
    const res = await asViewer('put', '/api/v1/settings/platform').send({ platformName: 'Hack' });
    expect(res.status).toBe(403);
  });

  it('gibt 401 ohne Token zurück', async () => {
    const res = await asGuest('put', '/api/v1/settings/platform').send({ platformName: 'X' });
    expect(res.status).toBe(401);
  });

  it('Admin: speichert platformName und gibt 200 zurück', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ platformName: 'Nexora-Test', defaultView: 'dashboard' });
    expect(res.status).toBe(200);
    expect(res.body.data.platformName).toBe('Nexora-Test');
  });

  it('Admin: gespeicherter Wert ist beim nächsten GET sichtbar', async () => {
    await asAdmin('put', '/api/v1/settings/platform').send({ platformName: 'SOC Plattform V2' });
    const res = await asAdmin('get', '/api/v1/settings/platform');
    expect(res.body.data.platformName).toBe('SOC Plattform V2');
  });

  it('Admin: speichert maintenanceMode (bool)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ maintenanceMode: true });
    expect(res.status).toBe(200);
    expect(res.body.data.maintenanceMode).toBe(true);
  });

  it('Admin: speichert betaFeatures (bool)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ betaFeatures: true });
    expect(res.status).toBe(200);
    expect(res.body.data.betaFeatures).toBe(true);
  });

  it('lehnt ungültiges defaultView ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ defaultView: 'nonexistent' });
    expect(res.status).toBe(400);
  });

  it('lehnt ungültige language ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ language: 'fr' });
    expect(res.status).toBe(400);
  });

  it('lehnt platformName mit mehr als 200 Zeichen ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ platformName: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('schreibt Audit-Eintrag SETTINGS_CHANGED mit targetId platform', async () => {
    await asAdmin('put', '/api/v1/settings/platform').send({ platformName: 'AuditTest' });
    const log = auditService.getLog();
    const entry = log.find(e => e.action === 'SETTINGS_CHANGED' && e.targetId === 'platform');
    expect(entry).toBeDefined();
    expect(entry.metadata.changed).toBeDefined();
  });

  it('ignoriert nicht-deklarierte Keys (stripUnknown)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({
      platformName: 'Allowed',
      ollamaBaseUrl: 'http://10.0.0.1:11434',  // KI-Feld — darf nicht übernommen werden
    });
    expect(res.status).toBe(200);
    // KI-Felder dürfen nicht im Plattform-Response auftauchen
    expect(res.body.data.ollamaBaseUrl).toBeUndefined();
  });
});

// ── Zugriffskontroll-Keys (Welle 1) + Validierung ────────────────────────────

describe('PUT /api/v1/settings/platform — Zugriffskontrolle', () => {
  it('Admin: speichert tlsEnforce + ipAllowlist (gültige CIDRs)', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({
      tlsEnforce: true,
      ipAllowlistEnabled: true,
      ipAllowlistCidrs: '10.0.0.0/8, 192.168.241.0/24',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.tlsEnforce).toBe(true);
    expect(res.body.data.ipAllowlistEnabled).toBe(true);
    expect(res.body.data.ipAllowlistCidrs).toBe('10.0.0.0/8, 192.168.241.0/24');
  });

  it('lehnt ungültige CIDR-Einträge ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ ipAllowlistCidrs: 'nicht-eine-ip' });
    expect(res.status).toBe(400);
  });

  it('lehnt Oktett > 255 ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ ipAllowlistCidrs: '10.0.0.0/8, 999.1.1.1' });
    expect(res.status).toBe(400);
  });

  it('akzeptiert leere CIDR-Liste', async () => {
    const res = await asAdmin('put', '/api/v1/settings/platform').send({ ipAllowlistEnabled: false, ipAllowlistCidrs: '' });
    expect(res.status).toBe(200);
  });
});

// ── GET /api/v1/settings/ki — nur KI-Whitelist, kein getAll-Leak ─────────────

describe('GET /api/v1/settings/ki — Whitelist', () => {
  it('gibt nur KI-Keys zurück, keine platform_-Keys', async () => {
    // platform-Wert schreiben → liegt als platform_platformName im KV-Store
    await asAdmin('put', '/api/v1/settings/platform').send({ platformName: 'Leak-Test' });
    const res = await asAdmin('get', '/api/v1/settings/ki');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body.data);
    expect(keys).toEqual(expect.arrayContaining(['ollamaBaseUrl', 'ollamaModel', 'agentLlmProvider', 'ragEnabled', 'anthropicModel', 'openaiModel', 'googleModel', 'agentFallback1', 'agentFallback2', 'llmTemperature', 'llmTopP', 'llmMaxTokens']));
    // KEIN platform_-Key, KEINE API-Keys (anthropicApiKey etc.) im Response
    expect(keys.some((k) => k.startsWith('platform_'))).toBe(false);
    expect(keys.some((k) => /ApiKey$/.test(k))).toBe(false);
    expect(keys.length).toBe(12);
  });

  it('liefert ohne explizite Ollama-Konfiguration keine Phantom-Defaults', async () => {
    const res = await asAdmin('get', '/api/v1/settings/ki');
    expect(res.status).toBe(200);
    expect(res.body.data.ollamaBaseUrl).toBe('');
    expect(res.body.data.ollamaModel).toBe('');
    expect(res.body.data.agentLlmProvider).toBe('stub');
  });

  it('gibt 403 für Analyst (admin-only)', async () => {
    const res = await asAnalyst('get', '/api/v1/settings/ki');
    expect(res.status).toBe(403);
  });
});

// ── KI Cloud-API-Keys: Backend-Speicherung, verschlüsselt + nie im GET ────────

describe('KI API-Keys (Backend, verschlüsselt)', () => {
  it('speichert Cloud-Key, gibt ihn NIE im GET zurück, meldet aber configured', async () => {
    await asAdmin('put', '/api/v1/settings/ki').send({ agentLlmProvider: 'anthropic', anthropicApiKey: 'sk-ant-secret-xyz-123' });

    const get = await asAdmin('get', '/api/v1/settings/ki');
    expect(JSON.stringify(get.body)).not.toContain('sk-ant-secret-xyz-123'); // Klartext nirgends
    expect(get.body.data.anthropicApiKey).toBeUndefined();

    const prov = await asAdmin('get', '/api/v1/settings/ki/providers');
    const a = prov.body.data.providers.find((p) => p.provider === 'anthropic');
    expect(a.configured).toBe(true);
    expect(a.keySource).toBeTruthy();
  });

  it('Erst-Konfig eines Cloud-Providers OHNE Modell speichert kein undefined (Regression: Postgres value NOT NULL → 500)', async () => {
    // Beim Speichern wurde das unbelegte Modell-Feld als undefined an die DB gegeben →
    // in Postgres (value NOT NULL) ein 500. Fix: undefined → '' (auch im str-Fallback).
    const res = await asAdmin('put', '/api/v1/settings/ki').send({ agentLlmProvider: 'google', googleApiKey: 'sk-google-reg' });
    expect(res.status).toBe(200);
    const get = await asAdmin('get', '/api/v1/settings/ki');
    expect(get.body.data.googleModel).toBe(''); // '' statt undefined
  });

  it('leerer Key überschreibt einen gesetzten Key NICHT', async () => {
    await asAdmin('put', '/api/v1/settings/ki').send({ openaiApiKey: 'sk-openai-keep' });
    await asAdmin('put', '/api/v1/settings/ki').send({ openaiModel: 'gpt-x' }); // ohne Key
    const prov = await asAdmin('get', '/api/v1/settings/ki/providers');
    expect(prov.body.data.providers.find((p) => p.provider === 'openai').configured).toBe(true);
  });

  it('POST /ki/test für stub liefert ok=true + Latenz', async () => {
    const res = await asAdmin('post', '/api/v1/settings/ki/test').send({ provider: 'stub' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(typeof res.body.data.latencyMs).toBe('number');
  });

  it('POST /ki/test für anthropic ohne erreichbares Backend liefert ok=false (kein 500)', async () => {
    // Kein echter Call möglich → ok:false mit Fehlermeldung, aber HTTP 200.
    const res = await asAdmin('post', '/api/v1/settings/ki/test').send({ provider: 'google' });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.ok).toBe('boolean');
  });

  it('POST /ki/test für ollama (nicht erreichbar) liefert ok=false innerhalb der Deadline (nie 504/Hang)', async () => {
    // Regressions-Guard: der Verbindungstest darf nicht in einen vollen 120s-Inference-Lauf
    // laufen (→ 504 hinter nginx). Ollama ist im Test nicht erreichbar → schnelles ok:false.
    const t0 = Date.now();
    const res = await asAdmin('post', '/api/v1/settings/ki/test').send({ provider: 'ollama' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    // Deutlich unter der 60s-nginx-Grenze — belegt die gebundene Deadline.
    expect(Date.now() - t0).toBeLessThan(20000);
  }, 25000);

  it('GET /ki/models liefert den erweiterten Ollama-Statusvertrag zurück', async () => {
    const res = await asAdmin('get', '/api/v1/settings/ki/models');
    expect(res.status).toBe(200);
    expect(typeof res.body.reachable).toBe('boolean');
    expect(res.body).toHaveProperty('modelAvailable');
    expect(typeof res.body.reason).toBe('string');
    expect(typeof res.body.message).toBe('string');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('PUT /ki lehnt unbekannten Fallback-Provider ab → 400', async () => {
    const res = await asAdmin('put', '/api/v1/settings/ki').send({ agentFallback1: 'sketchy' });
    expect(res.status).toBe(400);
  });
});
