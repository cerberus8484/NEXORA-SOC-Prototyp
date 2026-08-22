'use strict';

/**
 * API-Tests: GET /v1/use-case-drafts/:id/export?format=...
 * - 200 mit content für gültige Formate
 * - 400 für unbekanntes / fehlendes format
 * - 404 für unbekannte Draft-ID
 * - 401 ohne Auth
 */
const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { useCaseDeveloperService } = require('../../src/services/useCaseDeveloperInstance');

let analystToken;
let draftId;

async function mkUser(role) {
  const email = `export-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}

beforeAll(async () => {
  analystToken = await mkUser('analyst');

  // Draft erzeugen, damit wir eine echte ID haben
  const r = await useCaseDeveloperService.generate({
    sourceType: 'manual',
    sourceId:   'export-test',
    actor:      { id: 'test-actor', role: 'analyst', label: 'test@x.io' },
  });
  draftId = r.draft.id;
});

// auth(token).get(url) — Muster aus bestehenden API-Tests
const auth = (token) => ({
  get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
});

const BASE = '/api/v1/use-case-drafts';

describe('GET /use-case-drafts/:id/export — Auth', () => {
  it('ohne Auth → 401', async () => {
    const res = await request(app).get(`${BASE}/${draftId}/export?format=sigma`);
    expect(res.status).toBe(401);
  });
});

describe('GET /use-case-drafts/:id/export — Format-Validierung', () => {
  it('format=sigma → 200 mit content und language', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export?format=sigma`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(typeof res.body.data.content).toBe('string');
    expect(res.body.data.content.length).toBeGreaterThan(0);
    expect(res.body.data.format).toBe('sigma');
    expect(res.body.data.language).toBeDefined();
  });

  it('format=wazuh → 200 mit XML-content', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export?format=wazuh`);
    expect(res.status).toBe(200);
    expect(res.body.data.content).toContain('<rule id=');
    expect(res.body.data.format).toBe('wazuh');
  });

  it('format=splunk → 200 mit SPL-content', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export?format=splunk`);
    expect(res.status).toBe(200);
    expect(res.body.data.content).toMatch(/index=/);
    expect(res.body.data.format).toBe('splunk');
  });

  it('format=qradar → 200 mit AQL-content (FROM events)', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export?format=qradar`);
    expect(res.status).toBe(200);
    expect(res.body.data.content).toContain('FROM events');
    expect(res.body.data.format).toBe('qradar');
  });

  it('unbekanntes format → 400', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export?format=elastic`);
    expect(res.status).toBe(400);
  });

  it('fehlendes format → 400', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export`);
    expect(res.status).toBe(400);
  });

  it('leeres format → 400', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export?format=`);
    expect(res.status).toBe(400);
  });
});

describe('GET /use-case-drafts/:id/export — 404', () => {
  it('unbekannte Draft-ID → 404', async () => {
    const res = await auth(analystToken).get(`${BASE}/00000000-0000-0000-0000-000000000000/export?format=sigma`);
    expect(res.status).toBe(404);
  });
});

describe('GET /use-case-drafts/:id/export — Response-Shape', () => {
  it('liefert requestId', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export?format=sigma`);
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeDefined();
  });

  it('data enthält format, language, content', async () => {
    const res = await auth(analystToken).get(`${BASE}/${draftId}/export?format=wazuh`);
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data).toHaveProperty('format', 'wazuh');
    expect(data).toHaveProperty('language');
    expect(data).toHaveProperty('content');
  });
});
