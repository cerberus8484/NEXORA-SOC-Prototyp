'use strict';

// /api/v1/collectors/activity — read-only Ingestion-Aktivität je Quelle.
// Auth + Antwort-Vertrag (die Aggregationslogik ist in
// tests/repositories/ticketIngestActivity.test.js unit-getestet).

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let token;

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  const email = `collector-${Date.now()}@test.soc`;
  await authService.register({ email, password: 'Test1234!', displayName: 'U', role: 'analyst' });
  token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
});

describe('GET /api/v1/collectors/activity', () => {
  it('401 ohne Token', async () => {
    expect((await request(app).get('/api/v1/collectors/activity')).status).toBe(401);
  });

  it('200 mit Token: sources-Array + ehrlicher liveProcessStatus.available=false', async () => {
    const res = await request(app).get('/api/v1/collectors/activity').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.sources)).toBe(true);
    expect(res.body.data.liveProcessStatus.available).toBe(false);
    expect(typeof res.body.data.liveProcessStatus.note).toBe('string');
  });
});
