'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { huntService } = require('../../src/threatHunting/services/huntServiceInstance');

const BASE = '/api/v1/hunts';

let analystToken;
let adminToken;

beforeEach(async () => {
  delete process.env.HUNT_RESPONSE_AUTO_EXECUTE_MOCK;
  delete process.env.HUNT_RESPONSE_REAL_EXEC_ENABLED;
  huntService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();

  const aEmail = `analyst-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' })).body.token;

  const dEmail = `admin-${Date.now()}@test.soc`;
  await authService.register({ email: dEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email: dEmail, password: 'Test1234!' })).body.token;
});

afterEach(() => {
  delete process.env.HUNT_RESPONSE_AUTO_EXECUTE_MOCK;
  delete process.env.HUNT_RESPONSE_REAL_EXEC_ENABLED;
});

const as = (token) => ({
  post: (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body || {}),
  get:  (url)       => request(app).get(url).set('Authorization', `Bearer ${token}`),
});

async function createSession() {
  const res = await as(analystToken).post(BASE, { targetHost: 'win-client-01', scope: 'Containment' });
  return res.body.data.id;
}

describe('Hunt response actions API', () => {
  test('approved isolate_host bleibt ohne Flag im Status approved', async () => {
    const sid = await createSession();
    const requested = await as(analystToken).post(`${BASE}/${sid}/response-actions`, { kind: 'isolate_host', reason: 'C2 beacon' });
    const approved = await as(adminToken).post(`${BASE}/${sid}/response-actions/${requested.body.data.id}/approve`, {
      authorizationBasis: 'Notfall-Freigabe BR-2026-07',
    });

    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('approved');
    expect(approved.body.data.note).toMatch(/Agent/i);
  });

  test('approved isolate_host wird mit Flag automatisch mock-completed', async () => {
    process.env.HUNT_RESPONSE_AUTO_EXECUTE_MOCK = 'true';
    const sid = await createSession();
    const requested = await as(analystToken).post(`${BASE}/${sid}/response-actions`, { kind: 'isolate_host', reason: 'C2 beacon' });
    const approved = await as(adminToken).post(`${BASE}/${sid}/response-actions/${requested.body.data.id}/approve`, {
      authorizationBasis: 'Notfall-Freigabe BR-2026-07',
    });

    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('completed');
    expect(approved.body.data.note).toMatch(/Mock-Containment abgeschlossen/i);

    const list = await as(adminToken).get(`${BASE}/${sid}/response-actions`);
    expect(list.body.data[0].status).toBe('completed');
  });
});

describe('Hunt response EXECUTION API (ADR-042, echter Exec — gated)', () => {
  async function approvedActionId(sid) {
    const requested = await as(analystToken).post(`${BASE}/${sid}/response-actions`, { kind: 'isolate_host', reason: 'C2' });
    await as(adminToken).post(`${BASE}/${sid}/response-actions/${requested.body.data.id}/approve`,
      { authorizationBasis: 'Notfall-Freigabe BR-2026-07' });
    return requested.body.data.id;
  }

  test('analyst darf NICHT ausführen (admin-only → 403)', async () => {
    const sid = await createSession();
    const aid = await approvedActionId(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/response-actions/${aid}/execute`);
    expect(res.status).toBe(403);
  });

  test('Gate AUS (Default) → 503 (echter Exec nicht scharfgeschaltet)', async () => {
    const sid = await createSession();
    const aid = await approvedActionId(sid);
    const res = await as(adminToken).post(`${BASE}/${sid}/response-actions/${aid}/execute`);
    expect(res.status).toBe(503);
  });

  test('Gate AN, aber ohne X-Reauth-Token → 401 (fail-closed)', async () => {
    process.env.HUNT_RESPONSE_REAL_EXEC_ENABLED = 'true';
    const sid = await createSession();
    const aid = await approvedActionId(sid);
    const res = await as(adminToken).post(`${BASE}/${sid}/response-actions/${aid}/execute`);
    expect(res.status).toBe(401);
  });

  describe('Containment-Circuit-Breaker-Routen (ADR-042)', () => {
    afterEach(async () => { await huntService.resetResponseCircuit({ actor: { id: 'test' } }); });

    test('GET /response-circuit (viewer+) → Zustand, wird NICHT als Session-ID interpretiert', async () => {
      const res = await as(analystToken).get(`${BASE}/response-circuit`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ open: false, threshold: expect.any(Number) });
    });

    test('POST /response-circuit/reset ohne Admin → 403', async () => {
      const res = await as(analystToken).post(`${BASE}/response-circuit/reset`);
      expect(res.status).toBe(403);
    });

    test('POST /response-circuit/reset als Admin → 200, Kanal geschlossen', async () => {
      const res = await as(adminToken).post(`${BASE}/response-circuit/reset`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ open: false });
    });
  });
});
