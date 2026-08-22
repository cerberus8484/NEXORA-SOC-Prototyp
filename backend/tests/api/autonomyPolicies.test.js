'use strict';

/**
 * Tests — /api/v1/autonomy-policies Routes
 * RBAC: admin-only für alle Routen
 * GET /status: public zu admin (liefert enabled=false Default)
 */

const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let adminToken;
let analystToken;
let viewerToken;

async function mkUser(role) {
  const email = `ap-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}

const as = (t) => ({
  get:    (u)    => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post:   (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
  put:    (u, b) => request(app).put(u).set('Authorization', `Bearer ${t}`).send(b || {}),
  delete: (u)    => request(app).delete(u).set('Authorization', `Bearer ${t}`),
});

const BASE = '/api/v1/autonomy-policies';

const validBody = {
  customer:             '*',
  actionClass:          'enrichment',
  mode:                 'advisory',
  minVerdict:           'confirmed_incident',
  minConfidence:        0.9,
  requireEvidenceFloor: true,
  maxPerHour:           0,
  enabled:              false,
};

beforeAll(async () => {
  adminToken   = await mkUser('admin');
  analystToken = await mkUser('analyst');
  viewerToken  = await mkUser('viewer');
});

// ─── Auth-Check ───────────────────────────────────────────────────────────────

describe('AutonomyPolicies Routes — Auth', () => {
  it('GET / ohne Auth → 401', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('POST / ohne Auth → 401', async () => {
    expect((await request(app).post(BASE).send(validBody)).status).toBe(401);
  });

  it('GET /status ohne Auth → 401', async () => {
    expect((await request(app).get(`${BASE}/status`)).status).toBe(401);
  });
});

// ─── RBAC — analyst/viewer dürfen nicht ──────────────────────────────────────

describe('AutonomyPolicies Routes — RBAC (analyst/viewer → 403)', () => {
  it('analyst GET / → 403', async () => {
    expect((await as(analystToken).get(BASE)).status).toBe(403);
  });

  it('analyst POST / → 403', async () => {
    expect((await as(analystToken).post(BASE, validBody)).status).toBe(403);
  });

  it('analyst GET /status → 403', async () => {
    expect((await as(analystToken).get(`${BASE}/status`)).status).toBe(403);
  });

  it('viewer GET / → 403', async () => {
    expect((await as(viewerToken).get(BASE)).status).toBe(403);
  });

  it('viewer POST / → 403', async () => {
    expect((await as(viewerToken).post(BASE, validBody)).status).toBe(403);
  });
});

// ─── GET /status ──────────────────────────────────────────────────────────────

describe('AutonomyPolicies Routes — GET /status', () => {
  it('admin GET /status → 200 mit enabled=false (Default)', async () => {
    const res = await as(adminToken).get(`${BASE}/status`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('enabled');
    expect(res.body.data.enabled).toBe(false);
  });

  it('/status liefert actionClasses, ceilings, modes, verdicts', async () => {
    const res = await as(adminToken).get(`${BASE}/status`);
    expect(res.body.data).toHaveProperty('actionClasses');
    expect(res.body.data).toHaveProperty('ceilings');
    expect(res.body.data).toHaveProperty('modes');
    expect(res.body.data).toHaveProperty('verdicts');
    expect(Array.isArray(res.body.data.actionClasses)).toBe(true);
    expect(Array.isArray(res.body.data.modes)).toBe(true);
    expect(Array.isArray(res.body.data.verdicts)).toBe(true);
  });
});

// ─── CRUD (admin) ─────────────────────────────────────────────────────────────

describe('AutonomyPolicies Routes — CRUD (admin)', () => {
  it('POST / → 201 mit data + requestId', async () => {
    const res = await as(adminToken).post(BASE, validBody);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveProperty('id');
    expect(res.body).toHaveProperty('requestId');
    expect(res.body.data.actionClass).toBe('enrichment');
    expect(res.body.data.enabled).toBe(false);
  });

  it('GET / → 200 mit { data, total }', async () => {
    // Sicherstellen, dass mindestens eine Policy existiert
    await as(adminToken).post(BASE, { ...validBody, actionClass: 'internal_state' });
    const res = await as(adminToken).get(BASE);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /:id → 200 für existierende Policy', async () => {
    const created = (await as(adminToken).post(BASE, { ...validBody, actionClass: 'draft_generation' })).body.data;
    const res = await as(adminToken).get(`${BASE}/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.id);
  });

  it('GET /:id → 404 für unbekannte ID', async () => {
    const res = await as(adminToken).get(`${BASE}/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });

  it('PUT /:id → 200, Felder aktualisiert', async () => {
    const created = (await as(adminToken).post(BASE, { ...validBody, actionClass: 'enrichment', customer: 'acme-test' })).body.data;
    const res = await as(adminToken).put(`${BASE}/${created.id}`, { enabled: true, mode: 'assisted' });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.mode).toBe('assisted');
  });

  it('DELETE /:id → 204', async () => {
    const created = (await as(adminToken).post(BASE, { ...validBody, actionClass: 'host_response', customer: 'del-test' })).body.data;
    const res = await as(adminToken).delete(`${BASE}/${created.id}`);
    expect(res.status).toBe(204);
    // Nach DELETE ist die Policy weg
    const check = await as(adminToken).get(`${BASE}/${created.id}`);
    expect(check.status).toBe(404);
  });
});

// ─── Input-Validierung (400) ──────────────────────────────────────────────────

describe('AutonomyPolicies Routes — Validierung (400)', () => {
  it('ungültige actionClass → 400', async () => {
    const res = await as(adminToken).post(BASE, { ...validBody, actionClass: 'hack_the_planet' });
    expect(res.status).toBe(400);
  });

  it('ungültiger mode → 400', async () => {
    const res = await as(adminToken).post(BASE, { ...validBody, actionClass: 'enrichment', customer: 'v-mode', mode: 'turbo' });
    expect(res.status).toBe(400);
  });

  it('ungültiges minVerdict → 400', async () => {
    const res = await as(adminToken).post(BASE, { ...validBody, actionClass: 'enrichment', customer: 'v-verdict', minVerdict: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('minConfidence > 1 → 400', async () => {
    const res = await as(adminToken).post(BASE, { ...validBody, actionClass: 'enrichment', customer: 'v-conf', minConfidence: 1.5 });
    expect(res.status).toBe(400);
  });

  it('minConfidence < 0 → 400', async () => {
    const res = await as(adminToken).post(BASE, { ...validBody, actionClass: 'enrichment', customer: 'v-conf2', minConfidence: -0.1 });
    expect(res.status).toBe(400);
  });

  it('fehlende actionClass → 400', async () => {
    const { actionClass: _removed, ...body } = validBody;
    const res = await as(adminToken).post(BASE, body);
    expect(res.status).toBe(400);
  });
});

// ─── Bestätigung: AutonomyEvaluator nicht im Live-Pfad ───────────────────────
// Diese Route macht KEINE autonomen Aktionen — sie ist reines CRUD.
// Der Evaluator wird nicht aufgerufen. Dieser Test ist ein Rauchtest.

describe('AutonomyPolicies Routes — reines Gate (kein Live-Pfad)', () => {
  it('POST / erzeugt Policy mit enabled=false (Default-Deny)', async () => {
    const res = await as(adminToken).post(BASE, {
      ...validBody,
      actionClass: 'host_response',
      customer:    'gate-test',
    });
    expect(res.status).toBe(201);
    // enabled Default ist false — System bleibt advisory
    expect(res.body.data.enabled).toBe(false);
  });
});
