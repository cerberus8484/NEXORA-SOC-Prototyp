'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { ticketService } = require('../../src/services/TicketService');

describe('POST /api/v1/auth/login JSON token policy', () => {
  beforeEach(() => {
    authService._users.clear();
    authService._blocklist.clear();
    auditService.clearLog();
    ticketService._repo.clear();
  });

  afterEach(() => {
    delete process.env.AUTH_RETURN_TOKEN_JSON;
  });

  test('AUTH_RETURN_TOKEN_JSON=false -> Session nur ueber Cookie, kein Token im Body', async () => {
    process.env.AUTH_RETURN_TOKEN_JSON = 'false';
    await authService.register({ email: 'cookie@test.soc', password: 'Test1234!', displayName: 'Cookie' });

    const res = await request(app).post('/api/v1/auth/login').send({ email: 'cookie@test.soc', password: 'Test1234!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user.email).toBe('cookie@test.soc');
    expect(res.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringContaining('soc_token='),
      expect.stringContaining('csrf_token='),
    ]));
  });

  test('AUTH_RETURN_TOKEN_JSON=true -> Bearer-Kompatibilitaet bleibt verfuegbar', async () => {
    process.env.AUTH_RETURN_TOKEN_JSON = 'true';
    await authService.register({ email: 'compat@test.soc', password: 'Test1234!', displayName: 'Compat' });

    const res = await request(app).post('/api/v1/auth/login').send({ email: 'compat@test.soc', password: 'Test1234!' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('compat@test.soc');
  });
});
