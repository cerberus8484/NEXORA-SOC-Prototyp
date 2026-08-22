'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let token;
beforeAll(async () => {
  const email = `audit-${Date.now()}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
});

describe('GET /api/v1/audit', () => {
  test('liefert die letzten Audit-Einträge (z. B. nach Ticket-Create)', async () => {
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${token}`).send({ title: 'Audit-Test-Ticket' });
    const res = await request(app).get('/api/v1/audit?limit=10').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((e) => e.action === 'TICKET_CREATE')).toBe(true);
    const e = res.body.data[0];
    expect(e).toHaveProperty('action');
    expect(e).toHaveProperty('createdAt');
  });

  test('action-Filter', async () => {
    const res = await request(app).get('/api/v1/audit?action=TICKET_CREATE&limit=5').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => e.action === 'TICKET_CREATE')).toBe(true);
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/audit');
    expect(res.status).toBe(401);
  });
});
