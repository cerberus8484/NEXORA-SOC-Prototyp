'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let token;
let viewerToken;
beforeAll(async () => {
  const email = `ti-${Date.now()}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;

  const viewerEmail = `ti-viewer-${Date.now()}@x.io`;
  await authService.register({ email: viewerEmail, password: 'Test1234!', displayName: 'Viewer', role: 'viewer' });
  viewerToken = (await request(app).post('/api/v1/auth/login').send({ email: viewerEmail, password: 'Test1234!' })).body.token;
});
const post = (body) => request(app).post('/api/v1/threat-intel/enrich').set('Authorization', `Bearer ${token}`).send(body);

describe('POST /threat-intel/enrich', () => {
  test('224.0.0.7 → normalisiertes Ergebnis, nicht malicious', async () => {
    const res = await post({ indicatorType: 'ip', indicatorValue: '224.0.0.7' });
    expect(res.status).toBe(200);
    expect(res.body.data.verdict).not.toBe('malicious');
    expect(res.body.data.tags).toEqual(expect.arrayContaining(['multicast']));
    expect(res.body.data.source).toBe('mock');
  });

  test('ungültige IP → 400', async () => {
    const res = await post({ indicatorType: 'ip', indicatorValue: 'not-an-ip' });
    expect(res.status).toBe(400);
  });

  test('nicht unterstützter Typ → 400', async () => {
    const res = await post({ indicatorType: 'email', indicatorValue: 'x@y.z' });
    expect(res.status).toBe(400);
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).post('/api/v1/threat-intel/enrich').send({ indicatorType: 'ip', indicatorValue: '8.8.8.8' });
    expect(res.status).toBe(401);
  });
  test('viewer darf keine externen Enrichment-Provider triggern -> 403', async () => {
    const res = await request(app)
      .post('/api/v1/threat-intel/enrich')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ indicatorType: 'ip', indicatorValue: '8.8.8.8' });
    expect(res.status).toBe(403);
  });
});
