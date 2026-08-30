'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { huntService }  = require('../../src/threatHunting/services/huntServiceInstance');

const BASE = '/api/v1/hunts';

let analystToken;
let viewerToken;
let adminToken;

beforeEach(async () => {
  // Repos leeren
  huntService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();

  // Analyst
  const aEmail = `analyst-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  const aRes = await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' });
  analystToken = aRes.body.token;

  // Viewer
  const vEmail = `viewer-${Date.now()}@test.soc`;
  await authService.register({ email: vEmail, password: 'Test1234!', displayName: 'Viewer', role: 'viewer' });
  const vRes = await request(app).post('/api/v1/auth/login').send({ email: vEmail, password: 'Test1234!' });
  viewerToken = vRes.body.token;

  // Admin
  const dEmail = `admin-${Date.now()}@test.soc`;
  await authService.register({ email: dEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  const dRes = await request(app).post('/api/v1/auth/login').send({ email: dEmail, password: 'Test1234!' });
  adminToken = dRes.body.token;
});

const as = (token) => ({
  get:  (url)        => request(app).get(url).set('Authorization',  `Bearer ${token}`),
  post: (url, body)  => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body || {}),
});

// ─── POST /v1/hunts ───────────────────────────────────────────────────────────

describe('POST /api/v1/hunts', () => {
  it('Analyst kann Session anlegen → 201', async () => {
    const res = await as(analystToken).post(BASE, { targetHost: '10.0.0.5', scope: 'Test' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('planned');
    expect(res.body.data.targetHost).toBe('10.0.0.5');
    expect(res.body.data.id).toBeDefined();
  });

  it('Viewer kann keine Session anlegen → 403', async () => {
    const res = await as(viewerToken).post(BASE, { targetHost: '10.0.0.1' });
    expect(res.status).toBe(403);
  });

  it('Kein Token → 401', async () => {
    const res = await request(app).post(BASE).send({ targetHost: '10.0.0.1' });
    expect(res.status).toBe(401);
  });

  it('Fehlendes targetHost → 400', async () => {
    const res = await as(analystToken).post(BASE, { scope: 'no host' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /v1/hunts ────────────────────────────────────────────────────────────

describe('GET /api/v1/hunts', () => {
  it('Viewer kann Sessions lesen → 200 + leere Liste', async () => {
    const res = await as(viewerToken).get(BASE);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filtert nach ticketId', async () => {
    await as(analystToken).post(BASE, { targetHost: 'h1', ticketId: '00000000-0000-0000-0000-000000000001' });
    await as(analystToken).post(BASE, { targetHost: 'h2', ticketId: '00000000-0000-0000-0000-000000000002' });
    const res = await as(viewerToken).get(`${BASE}?ticketId=00000000-0000-0000-0000-000000000001`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].targetHost).toBe('h1');
  });
});

// ─── GET /v1/hunts/:id ────────────────────────────────────────────────────────

describe('GET /api/v1/hunts/:id', () => {
  it('gibt Session zurück', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const id  = created.body.data.id;
    const res = await as(viewerToken).get(`${BASE}/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('unbekannte ID → 404', async () => {
    const res = await as(viewerToken).get(`${BASE}/no-such-id`);
    expect(res.status).toBe(404);
  });
});

// ─── Lifecycle Endpunkte ──────────────────────────────────────────────────────

describe('POST /api/v1/hunts/:id/start', () => {
  it('aktiviert Session → status active', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const id = created.body.data.id;
    const res = await as(analystToken).post(`${BASE}/${id}/start`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.startedAt).toBeDefined();
  });

  it('Viewer kann nicht starten → 403', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const res = await as(viewerToken).post(`${BASE}/${created.body.data.id}/start`);
    expect(res.status).toBe(403);
  });

  it('doppeltes Starten → 409 Conflict', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const id = created.body.data.id;
    await as(analystToken).post(`${BASE}/${id}/start`);
    const res = await as(analystToken).post(`${BASE}/${id}/start`);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/hunts/:id/complete', () => {
  it('schließt aktive Session ab → completed', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const id = created.body.data.id;
    await as(analystToken).post(`${BASE}/${id}/start`);
    const res = await as(analystToken).post(`${BASE}/${id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
  });

  it('planned → complete → 409 (muss erst aktiviert werden)', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const res = await as(analystToken).post(`${BASE}/${created.body.data.id}/complete`);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/v1/hunts/:id/fail', () => {
  it('nur Admin kann fail aufrufen', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const id = created.body.data.id;
    await as(analystToken).post(`${BASE}/${id}/start`);
    const res = await as(analystToken).post(`${BASE}/${id}/fail`, { reason: 'Timeout' });
    expect(res.status).toBe(403);
  });

  it('Admin kann aktive Session failen', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const id = created.body.data.id;
    await as(analystToken).post(`${BASE}/${id}/start`);
    const res = await as(adminToken).post(`${BASE}/${id}/fail`, { reason: 'Timeout' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('failed');
  });
});

describe('POST /api/v1/hunts/:id/cancel', () => {
  it('nur Admin kann cancel aufrufen', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const res = await as(analystToken).post(`${BASE}/${created.body.data.id}/cancel`);
    expect(res.status).toBe(403);
  });

  it('Admin cancelt geplante Session → cancelled', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const res = await as(adminToken).post(`${BASE}/${created.body.data.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });
});

// ─── Notes ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/hunts/:id/notes', () => {
  it('Analyst kann Notiz hinzufügen → 201', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const id = created.body.data.id;
    const res = await as(analystToken).post(`${BASE}/${id}/notes`, { content: 'Verdächtig!' });
    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe('Verdächtig!');
  });

  it('Viewer kann keine Notiz schreiben → 403', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const res = await as(viewerToken).post(`${BASE}/${created.body.data.id}/notes`, { content: 'x' });
    expect(res.status).toBe(403);
  });

  it('leere Notiz → 400', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const res = await as(analystToken).post(`${BASE}/${created.body.data.id}/notes`, { content: '' });
    expect(res.status).toBe(400);
  });

  it('Note auf unbekannte Session → 404', async () => {
    const res = await as(analystToken).post(`${BASE}/ghost-id/notes`, { content: 'test' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/hunts/:id/notes', () => {
  it('gibt alle Notizen zurück', async () => {
    const created = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const id = created.body.data.id;
    await as(analystToken).post(`${BASE}/${id}/notes`, { content: 'Erste' });
    await as(analystToken).post(`${BASE}/${id}/notes`, { content: 'Zweite' });
    const res = await as(viewerToken).get(`${BASE}/${id}/notes`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });
});

// ─── Read-Only Sub-Endpunkte ──────────────────────────────────────────────────

describe('GET /api/v1/hunts/:id/commands | artifacts | findings', () => {
  let sessionId;

  beforeEach(async () => {
    const res = await as(analystToken).post(BASE, { targetHost: 'h1' });
    sessionId = res.body.data.id;
  });

  it('GET commands → 200 + leeres Array', async () => {
    const res = await as(viewerToken).get(`${BASE}/${sessionId}/commands`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET artifacts → 200 + leeres Array', async () => {
    const res = await as(viewerToken).get(`${BASE}/${sessionId}/artifacts`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET findings → 200 + leeres Array', async () => {
    const res = await as(viewerToken).get(`${BASE}/${sessionId}/findings`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('GET commands auf unbekannte Session → 404', async () => {
    const res = await as(viewerToken).get(`${BASE}/ghost/commands`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /v1/hunts/:id/findings/:findingId/verdict (Block B2) ───────────────

describe('POST /api/v1/hunts/:id/findings/:findingId/verdict', () => {
  async function createSessionWithFinding() {
    // Anlegen mit Hunt-Runner, der synchron Findings erzeugt
    const sRes = await as(analystToken).post(BASE, {
      targetHost: 'h1', huntType: 'suspicious_powershell_hunt',
    });
    const sessionId = sRes.body.data.id;
    // Runner synchron starten (stepDelayMs=0 im Test via huntService direkt)
    await huntService.startHunt(sessionId, 'test-analyst', { stepDelayMs: 0 });
    const findings = await huntService.getFindings(sessionId);
    return { sessionId, findingId: findings[0].id };
  }

  it('Analyst setzt Verdict → 200 + verdict im Body', async () => {
    const { sessionId, findingId } = await createSessionWithFinding();
    const res = await as(analystToken).post(
      `${BASE}/${sessionId}/findings/${findingId}/verdict`,
      { verdict: 'suspicious' },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.verdict).toBe('suspicious');
  });

  it('Viewer darf Verdict nicht setzen → 403', async () => {
    const { sessionId, findingId } = await createSessionWithFinding();
    const res = await as(viewerToken).post(
      `${BASE}/${sessionId}/findings/${findingId}/verdict`,
      { verdict: 'benign' },
    );
    expect(res.status).toBe(403);
  });

  it('Ungültiges Verdict → 400', async () => {
    const { sessionId, findingId } = await createSessionWithFinding();
    const res = await as(analystToken).post(
      `${BASE}/${sessionId}/findings/${findingId}/verdict`,
      { verdict: 'totally_fine' },
    );
    expect(res.status).toBe(400);
  });

  it('Fehlendes verdict-Feld → 400', async () => {
    const { sessionId, findingId } = await createSessionWithFinding();
    const res = await as(analystToken).post(
      `${BASE}/${sessionId}/findings/${findingId}/verdict`,
      {},
    );
    expect(res.status).toBe(400);
  });

  it('Unbekannte Session → 404', async () => {
    const res = await as(analystToken).post(
      `${BASE}/ghost-session/findings/ghost-finding/verdict`,
      { verdict: 'benign' },
    );
    expect(res.status).toBe(404);
  });

  it('Unbekannte Finding-ID → 404', async () => {
    const sRes = await as(analystToken).post(BASE, { targetHost: 'h1' });
    const sessionId = sRes.body.data.id;
    const res = await as(analystToken).post(
      `${BASE}/${sessionId}/findings/non-existent/verdict`,
      { verdict: 'benign' },
    );
    expect(res.status).toBe(404);
  });

  it('Kein Token → 401', async () => {
    const res = await request(app)
      .post(`${BASE}/any-session/findings/any-finding/verdict`)
      .send({ verdict: 'benign' });
    expect(res.status).toBe(401);
  });

  it('Verdict kann geändert werden (suspicious → benign)', async () => {
    const { sessionId, findingId } = await createSessionWithFinding();
    await as(analystToken).post(
      `${BASE}/${sessionId}/findings/${findingId}/verdict`,
      { verdict: 'suspicious' },
    );
    const res = await as(analystToken).post(
      `${BASE}/${sessionId}/findings/${findingId}/verdict`,
      { verdict: 'benign' },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.verdict).toBe('benign');
  });
});
