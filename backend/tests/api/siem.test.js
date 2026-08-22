'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let token;
beforeAll(async () => {
  const email = `siem-${Date.now()}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: 'Analyst', role: 'viewer' });
  token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
});
const get = (path) => request(app).get(`/api/v1/siem${path}`).set('Authorization', `Bearer ${token}`);

describe('GET /siem/:siem/telemetry', () => {
  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/siem/wazuh/telemetry');
    expect(res.status).toBe(401);
  });

  test('unbekanntes SIEM → 404', async () => {
    const res = await get('/nope/telemetry');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('unknown_siem');
  });

  test('Prototype-Keys (__proto__/constructor) → 404, kein 500', async () => {
    for (const key of ['__proto__', 'constructor', 'hasOwnProperty']) {
      const res = await get(`/${key}/telemetry`);
      expect(res.status).toBe(404);
    }
  });

  test('wazuh ohne Konfiguration → enabled:false, data:null (kein Fehler)', async () => {
    const res = await get('/wazuh/telemetry');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.data).toBeNull();
  });

  test('viewer darf lesen (RBAC: requireAuth, kein Rollen-Gate)', async () => {
    const res = await get('');
    expect(res.status).toBe(200);
    expect(res.body.data.find((p) => p.key === 'wazuh')).toBeTruthy();
  });
});
