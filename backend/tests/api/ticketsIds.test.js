/**
 * @jest-environment node
 */
'use strict';

// GET /api/v1/tickets/ids — „alle gefilterten auswählen": nur IDs, limit bis 5000.
// Regression: die Liste (max 500) warf bei limit=5000 „Validation failed" — /ids nicht.

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

async function mkUser(role) {
  const email = `tid-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
  return { token };
}
const as = (t) => ({ get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`) });

let user;
beforeAll(async () => { user = await mkUser('analyst'); });

describe('GET /tickets/ids', () => {
  test('akzeptiert limit=5000 und liefert { ids, total }', async () => {
    const res = await as(user.token).get('/api/v1/tickets/ids?limit=5000');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.ids)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  test('Regression: die LISTE lehnt limit=5000 ab (der Bug, den /ids umgeht)', async () => {
    const res = await as(user.token).get('/api/v1/tickets?limit=5000');
    expect([400, 422]).toContain(res.status);
  });

  test('/ids deckelt bei 5000 — limit=6000 wird abgelehnt', async () => {
    const res = await as(user.token).get('/api/v1/tickets/ids?limit=6000');
    expect([400, 422]).toContain(res.status);
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/tickets/ids');
    expect(res.status).toBe(401);
  });
});
