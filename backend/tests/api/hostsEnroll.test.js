'use strict';

// Host-Enrollment-Route: POST /api/v1/hosts (admin) → registriert einen Wazuh-Agent.
// RBAC admin-only · Body-Validierung · liefert Enrollment-Key (einmalig).

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { wazuhApiClient } = require('../../src/integrations/adapters/wazuh/wazuhApiInstance');

let adminToken; let analystToken;
let origEnabled; let origAddAgent;

async function mkUser(role) {
  const email = `he-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.soc`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  return res.body.token;
}

beforeAll(async () => {
  adminToken = await mkUser('admin');
  analystToken = await mkUser('analyst');
});

beforeEach(() => {
  origEnabled = wazuhApiClient.isEnabled;
  origAddAgent = wazuhApiClient.addAgent;
  wazuhApiClient.isEnabled = () => true;
  wazuhApiClient.addAgent = async ({ name, ip }) => ({ id: '005', name, key: `ENROLLKEY-${ip || 'any'}` });
});
afterEach(() => {
  wazuhApiClient.isEnabled = origEnabled;
  wazuhApiClient.addAgent = origAddAgent;
});

const post = (token, body) => request(app).post('/api/v1/hosts').set('Authorization', `Bearer ${token}`).send(body);

describe('POST /api/v1/hosts — Host-Enrollment', () => {
  test('analyst → 403 (admin-only)', async () => {
    expect((await post(analystToken, { name: 'web01' })).status).toBe(403);
  });

  test('ohne Auth → 401', async () => {
    expect((await request(app).post('/api/v1/hosts').send({ name: 'web01' })).status).toBe(401);
  });

  test('ungültiger Body (kein Name) → 400', async () => {
    expect((await post(adminToken, { ip: '10.0.10.20' })).status).toBe(400);
  });

  test('ungültiger Name (Sonderzeichen) → 400', async () => {
    expect((await post(adminToken, { name: 'web 01; rm -rf' })).status).toBe(400);
  });

  test('ungültige IP → 400', async () => {
    expect((await post(adminToken, { name: 'web01', ip: 'not-an-ip' })).status).toBe(400);
  });

  test('admin + gültiger Body → 201 mit id/name/key', async () => {
    const res = await post(adminToken, { name: 'web01', ip: '10.0.10.20' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: '005', name: 'web01' });
    expect(res.body.data.key).toBeTruthy();
  });

  test('erfolgreiches Enrollment schreibt Audit-Eintrag (ohne Key)', async () => {
    const spy = jest.spyOn(auditService, 'write').mockResolvedValue(undefined);
    try {
      await post(adminToken, { name: 'web02', ip: '10.0.10.21' });
      expect(spy).toHaveBeenCalledTimes(1);
      const entry = spy.mock.calls[0][0];
      expect(entry).toMatchObject({ action: 'WAZUH_AGENT_ENROLLED', targetId: '005' });
      expect(JSON.stringify(entry)).not.toMatch(/ENROLLKEY/); // Key darf NIE ins Audit
    } finally { spy.mockRestore(); }
  });

  test('Wazuh nicht konfiguriert → 5xx (ehrlicher Fehler, kein stiller Erfolg)', async () => {
    wazuhApiClient.addAgent = async () => { throw new Error('Wazuh-API nicht konfiguriert'); };
    const res = await post(adminToken, { name: 'web01' });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
