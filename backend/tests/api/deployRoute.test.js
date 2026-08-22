'use strict';

// Deployment Center — Phase 6: /api/v1/deploy end-to-end (HTTP, InMemory).
// RBAC (admin-only), Body-Validierung, Vier-Augen, DEPLOY_ENABLED-Gate (default AUS).
// KEIN echtes Proxmox — der Connector-Fake greift im Test-Modus.

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

const BASE = '/api/v1/deploy';

async function mkUser(role) {
  const email = `dep-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
  return { email, token };
}
const as = (t) => ({
  get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

const CONNECTOR = {
  type: 'proxmox', name: 'Lab-PVE', host: '10.0.99.100', apiToken: 'root@pam!nexora=secret-uuid',
  targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1', verifyTls: true,
};
function specBody(connectorId) {
  return {
    moduleId: 'opnsense', connectorId, targetNode: 'pve1', storage: 'local-lvm', bridge: 'vmbr1',
    resources: { cpu: 2, ramMB: 2048, diskGB: 20 },
    params: { hostname: 'fw-lab', ipMode: 'static', staticIp: '10.0.10.1', cidr: 24, gateway: '10.0.10.254', vlanTag: 10, dns: ['10.0.10.10'], templateVmid: 9000 },
  };
}

// Connector-Anlegen verlangt jetzt frische Reauth (wie Apply) → pro Aufruf einen
// deploy_reauth-Token holen und als X-Reauth-Token mitschicken.
async function connectorReq(user, body = CONNECTOR) {
  const rt = (await request(app).post('/api/v1/auth/deploy-reauth')
    .set('Authorization', `Bearer ${user.token}`).send({ password: 'Test1234!' })).body.data.reauthToken;
  return request(app).post(`${BASE}/connectors`)
    .set('Authorization', `Bearer ${user.token}`).set('X-Reauth-Token', rt).send(body);
}

let admin1; let admin2; let analyst;
beforeAll(async () => {
  admin1 = await mkUser('admin');
  admin2 = await mkUser('admin');
  analyst = await mkUser('analyst');
});

describe('RBAC', () => {
  test('ohne Auth → 401', async () => {
    const res = await request(app).get(`${BASE}/modules`);
    expect(res.status).toBe(401);
  });
  test('analyst → 403 (admin-only)', async () => {
    expect((await as(analyst.token).get(`${BASE}/modules`)).status).toBe(403);
  });
  test('admin → 200, Katalog enthält opnsense', async () => {
    const res = await as(admin1.token).get(`${BASE}/modules`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => m.id)).toContain('opnsense');
  });
});

describe('Connector + Spec anlegen', () => {
  test('ungültiger Connector-Body → 400', async () => {
    const res = await as(admin1.token).post(`${BASE}/connectors`, { ...CONNECTOR, host: undefined });
    expect(res.status).toBe(400);
  });
  test('gültiger Connector → 201, kein Token-Leak', async () => {
    const res = await connectorReq(admin1);
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(JSON.stringify(res.body.data)).not.toContain('secret-uuid');
    expect(res.body.data).not.toHaveProperty('apiTokenEnc');
  });
  test('gültiger Connector OHNE frische Reauth → 401 (Step-up erforderlich)', async () => {
    const res = await as(admin1.token).post(`${BASE}/connectors`, CONNECTOR);
    expect(res.status).toBe(401);
  });
});

describe('plan → approve → apply (Gate AUS)', () => {
  let connectorId; let runId;

  test('Setup: Connector + Spec + Plan', async () => {
    connectorId = (await connectorReq(admin1)).body.data.id;
    const spec = (await as(admin1.token).post(`${BASE}/specs`, specBody(connectorId))).body.data;
    expect(spec.id).toBeTruthy();
    const plan = (await as(admin1.token).post(`${BASE}/specs/${spec.id}/plan`)).body.data;
    expect(plan.run.status).toBe('planned');
    expect(plan.preconditions).toBeTruthy();
    runId = plan.run.id;
  });

  test('approve durch den Ersteller → 403 (Vier-Augen)', async () => {
    const res = await as(admin1.token).post(`${BASE}/runs/${runId}/approve`, {});
    expect(res.status).toBe(403);
  });

  test('approve durch anderen Admin → 200 approved', async () => {
    const res = await as(admin2.token).post(`${BASE}/runs/${runId}/approve`, { note: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  test('apply bei DEPLOY_ENABLED=false → 403 E_DEPLOY_DISABLED (Kill-Switch)', async () => {
    const res = await as(admin2.token).post(`${BASE}/runs/${runId}/apply`, {});
    expect(res.status).toBe(403);
    expect(res.body.error || res.body.code || JSON.stringify(res.body)).toMatch(/DEPLOY_DISABLED|gesperrt|deploy/i);
  });
});

describe('deploy-reauth (frische Re-Auth für Apply)', () => {
  test('korrektes Passwort → deploy_reauth-Token', async () => {
    const res = await request(app).post('/api/v1/auth/deploy-reauth')
      .set('Authorization', `Bearer ${admin1.token}`).send({ password: 'Test1234!' });
    expect(res.status).toBe(200);
    expect(res.body.data.reauthToken).toBeTruthy();
  });
  test('falsches Passwort → 401', async () => {
    const res = await request(app).post('/api/v1/auth/deploy-reauth')
      .set('Authorization', `Bearer ${admin1.token}`).send({ password: 'falsch' });
    expect(res.status).toBe(401);
  });
  test('Nicht-Admin → 403 (admin-only)', async () => {
    const res = await request(app).post('/api/v1/auth/deploy-reauth')
      .set('Authorization', `Bearer ${analyst.token}`).send({ password: 'Test1234!' });
    expect(res.status).toBe(403);
  });
});

describe('Deploy-Audit', () => {
  test('GET /deploy/audit (admin) → 200 mit Einträgen aus dem Fluss', async () => {
    const res = await as(admin1.token).get(`${BASE}/audit`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0); // connector/spec/plan/approve wurden auditiert
  });
  test('GET /deploy/audit ohne Auth → 401', async () => {
    expect((await request(app).get(`${BASE}/audit`)).status).toBe(401);
  });
});

describe('POST /deploy/nodes/:nodeId/update — updatebar (gated, inert)', () => {
  test('ohne Auth → 401', async () => {
    expect((await request(app).post(`${BASE}/nodes/n1/update`).send({})).status).toBe(401);
  });
  test('analyst → 403 (admin-only)', async () => {
    expect((await as(analyst.token).post(`${BASE}/nodes/n1/update`, {})).status).toBe(403);
  });
  test('admin, aber NODE_UPDATE_ENABLED aus → 403 E_NOT_ARMED (fail-closed, Route gemountet)', async () => {
    const res = await as(admin1.token).post(`${BASE}/nodes/n1/update`, {});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('E_NOT_ARMED');
  });
});

describe('POST /deploy/nodes/:nodeId/hostkey/capture — Host-Key erfassen (admin + reauth)', () => {
  test('ohne Auth → 401', async () => {
    expect((await request(app).post(`${BASE}/nodes/n1/hostkey/capture`).send({})).status).toBe(401);
  });
  test('analyst → 403 (admin-only)', async () => {
    expect((await as(analyst.token).post(`${BASE}/nodes/n1/hostkey/capture`, {})).status).toBe(403);
  });
  test('admin ohne X-Reauth-Token → 401 E_REAUTH (fail-closed, Route gemountet)', async () => {
    const res = await as(admin1.token).post(`${BASE}/nodes/n1/hostkey/capture`, {});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('E_REAUTH');
  });
});

describe('Deploy-Keypair (Slice 6d) — GET maskiert + POST generate (admin + reauth)', () => {
  test('GET /keypair ohne Auth → 401 · analyst → 403', async () => {
    expect((await request(app).get(`${BASE}/keypair`)).status).toBe(401);
    expect((await as(analyst.token).get(`${BASE}/keypair`)).status).toBe(403);
  });
  test('GET /keypair admin → 200, NIE der Private-Key im Body', async () => {
    const res = await as(admin1.token).get(`${BASE}/keypair`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|privateKeyEnc/);
  });
  test('POST /keypair/generate admin ohne Reauth → 401 E_REAUTH', async () => {
    const res = await as(admin1.token).post(`${BASE}/keypair/generate`, {});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('E_REAUTH');
  });
  test('POST /keypair/generate admin + Reauth → 201, Public-Key + Fingerprint, kein Private-Key', async () => {
    const rt = (await request(app).post('/api/v1/auth/deploy-reauth').set('Authorization', `Bearer ${admin1.token}`).send({ password: 'Test1234!' })).body.data.reauthToken;
    const res = await request(app).post(`${BASE}/keypair/generate`).set('Authorization', `Bearer ${admin1.token}`).set('X-Reauth-Token', rt).send({});
    expect(res.status).toBe(201);
    expect(res.body.data.publicKey).toMatch(/^ssh-ed25519 /);
    expect(res.body.data.fingerprint).toMatch(/^SHA256:/);
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|privateKeyEnc/);
  });
});
