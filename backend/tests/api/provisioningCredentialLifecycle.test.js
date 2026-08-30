'use strict';

// P_PROVISION_SECURITY_1 — Agent B: API-Ebene RED-Tests für Credential-Lifecycle.
//
// Muster: supertest + authService (wie in provisioning.test.js).
// Testet ROUTE-Ebene für:
//   - DELETE/POST /provisioning/nodes/:nodeId/credentials/:credId/revoke (NEUE Route)
//   - POST /provisioning/nodes/:nodeId/retire (NEUE Route)
//   - GET /provisioning/nodes/:nodeId/credentials (NEUE Route)
//   - Heartbeat nach Revoke → 401
//   - Heartbeat nach Retire → 401 oder 403
//   - RBAC: analyst/viewer darf nicht widerrufen
//   - Keine Secrets in API-Responses

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

async function mkUser(role) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `cred-lc-${role}-${suffix}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Test1234!' });
  return loginRes.body.token;
}

function as(token) {
  return {
    get:    (url)       => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post:   (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body || {}),
    delete: (url)       => request(app).delete(url).set('Authorization', `Bearer ${token}`),
  };
}

const BASE = '/api/v1/provisioning';

// SECRET_KEY-Regex (gleich wie in provisioningDomain.js:53)
const SECRET_KEY_RE = /(password|secret|token|api[_-]?key|apikey|privatekey|private_key|bearer|credential)/i;

function hasSecretKey(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).some(
    (k) => SECRET_KEY_RE.test(k) || hasSecretKey(obj[k])
  );
}

// ─── Shared Setup ─────────────────────────────────────────────────────────────

let adminToken;
let analystToken;

// Hilfsfunktion: vollständiger Enrollment-Flow → liefert nodeId + nodeCredential
async function performEnroll(adminTok, hostnameSuffix = '') {
  const hostname = `api-cred-test${hostnameSuffix}-${Date.now()}`;

  // 1. Enrollment-Profil anlegen
  const profileRes = await as(adminTok).post(`${BASE}/enrollment-profiles`, {
    name: `ep-${hostname}`,
    role: 'normal_agent',
    capabilities: ['heartbeat', 'inventory'],
  });
  expect(profileRes.status).toBe(201);
  const profileId = profileRes.body.data.id;

  // 2. Token minten
  const tokenRes = await as(adminTok).post(`${BASE}/enrollment-profiles/${profileId}/token`, {});
  expect(tokenRes.status).toBe(201);
  const enrollToken = tokenRes.body.data.token;

  // 3. Enroll (kein Auth-Header, Token im Body)
  const enrollRes = await request(app)
    .post(`${BASE}/enroll`)
    .send({ token: enrollToken, hostname, platform: 'Linux', ips: ['10.99.98.1'] });
  expect(enrollRes.status).toBe(201);

  const { nodeId, nodeCredential } = enrollRes.body.data;
  expect(typeof nodeCredential).toBe('string');
  expect(nodeCredential.startsWith('ncr_')).toBe(true);

  return { nodeId, nodeCredential, enrollToken };
}

beforeAll(async () => {
  adminToken = await mkUser('admin');
  analystToken = await mkUser('analyst');
});

// ─── A. RBAC: Nicht-Admin darf Credentials nicht widerrufen ──────────────────
//
// Route (noch nicht existierend):
//   POST /provisioning/nodes/:nodeId/credentials/:credId/revoke
//   requireAuth + requireRole('admin')

describe('A — RBAC: Nur Admin darf Credential widerrufen', () => {
  let nodeId; let credentialId;

  beforeAll(async () => {
    const result = await performEnroll(adminToken, '-rbac');
    nodeId = result.nodeId;

    // Credential-ID aus GET /nodes/:id/credentials (NEUE Route — RED)
    const listRes = await as(adminToken).get(`${BASE}/nodes/${nodeId}/credentials`);
    // Wenn Route noch nicht existiert: 404 — Test bleibt RED.
    expect(listRes.status).toBe(200); // RED: Route fehlt
    credentialId = listRes.body.data[0].id;
  });

  it('POST .../credentials/:credId/revoke ohne Auth → 401', async () => {
    const res = await request(app)
      .post(`${BASE}/nodes/${nodeId}/credentials/${credentialId}/revoke`)
      .send({ reason: 'test' });
    expect(res.status).toBe(401);
  });

  it('analyst POST .../credentials/:credId/revoke → 403', async () => {
    const res = await as(analystToken)
      .post(`${BASE}/nodes/${nodeId}/credentials/${credentialId}/revoke`, { reason: 'test' });
    // RED: Route fehlt → aktuell 404 statt 403. Grün, wenn Route + RBAC gebaut ist.
    expect(res.status).toBe(403);
  });

  it('admin POST .../credentials/:credId/revoke → 200', async () => {
    const res = await as(adminToken)
      .post(`${BASE}/nodes/${nodeId}/credentials/${credentialId}/revoke`, { reason: 'admin-rbac-test' });
    // RED: Route fehlt.
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('revoked');
  });
});

// ─── B. Revoke + Heartbeat-Ablehnung (API-Ebene) ─────────────────────────────

describe('B — Revoke: Heartbeat mit revoked Credential → 401', () => {
  it('Heartbeat mit Credential funktioniert VOR Revoke', async () => {
    const { nodeId, nodeCredential } = await performEnroll(adminToken, '-hb-before');

    const hbRes = await request(app)
      .post(`${BASE}/nodes/${nodeId}/heartbeat`)
      .set('Authorization', `Bearer ${nodeCredential}`)
      .send({ status: 'healthy' });
    expect(hbRes.status).toBe(200);
    expect(hbRes.body.data.accepted).toBe(true);
  });

  it('Heartbeat mit revoked Credential → 401', async () => {
    const { nodeId, nodeCredential } = await performEnroll(adminToken, '-hb-revoke');

    // Credential-ID aus GET /nodes/:id/credentials (RED: Route fehlt)
    const listRes = await as(adminToken).get(`${BASE}/nodes/${nodeId}/credentials`);
    expect(listRes.status).toBe(200); // RED
    const credentialId = listRes.body.data[0].id;

    // Revoke
    const revokeRes = await as(adminToken)
      .post(`${BASE}/nodes/${nodeId}/credentials/${credentialId}/revoke`, { reason: 'hb-test' });
    expect(revokeRes.status).toBe(200); // RED

    // Heartbeat nach Revoke
    const hbRes = await request(app)
      .post(`${BASE}/nodes/${nodeId}/heartbeat`)
      .set('Authorization', `Bearer ${nodeCredential}`)
      .send({ status: 'healthy' });
    expect(hbRes.status).toBe(401);
  });
});

// ─── C. Cross-Node-Schutz: Revoke einer anderen Node → 403/404 ───────────────

describe('C — Cross-Node-Schutz: Credential einer fremden Node widerrufen → 403', () => {
  it('Admin kann Credential von Node B nicht über Node-A-Route widerrufen → 403 oder 404', async () => {
    const resultA = await performEnroll(adminToken, '-cross-A');
    const resultB = await performEnroll(adminToken, '-cross-B');

    // Credential-ID von Node B
    const listB = await as(adminToken).get(`${BASE}/nodes/${resultB.nodeId}/credentials`);
    expect(listB.status).toBe(200); // RED
    const credIdB = listB.body.data[0].id;

    // Versuch: Credential von B über die Node-A-Route widerrufen
    const res = await as(adminToken)
      .post(`${BASE}/nodes/${resultA.nodeId}/credentials/${credIdB}/revoke`, { reason: 'cross-test' });

    // Erwartet: 403 (Credential gehört nicht zu dieser Node) oder 404.
    // RED: Route fehlt; sobald gebaut, muss sie die Node-Bindung prüfen.
    expect([403, 404]).toContain(res.status);
  });
});

// ─── D. Node-Retirement (API-Ebene) ──────────────────────────────────────────
//
// Neue Route: POST /provisioning/nodes/:id/retire
//   requireAuth + requireRole('admin')
//   ruft nodeEnrollmentService.retireNode(id, reason)

describe('D — Node-Retirement API', () => {
  it('POST /nodes/:id/retire ohne Auth → 401', async () => {
    const res = await request(app)
      .post(`${BASE}/nodes/00000000-0000-0000-0000-000000000001/retire`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('analyst POST /nodes/:id/retire → 403', async () => {
    const res = await as(analystToken)
      .post(`${BASE}/nodes/00000000-0000-0000-0000-000000000001/retire`, {});
    // RED: Route fehlt → aktuell 404. Grün wenn Route + RBAC gebaut.
    expect(res.status).toBe(403);
  });

  it('admin POST /nodes/:id/retire → 200, Node-Status ist retired', async () => {
    const { nodeId } = await performEnroll(adminToken, '-retire-d');

    const res = await as(adminToken)
      .post(`${BASE}/nodes/${nodeId}/retire`, { reason: 'lifecycle-end' });
    // RED: Route fehlt.
    expect(res.status).toBe(200);
    expect(res.body.data.nodeId).toBe(nodeId);

    // Node-Status prüfen
    const nodeRes = await as(adminToken).get(`${BASE}/nodes/${nodeId}`);
    expect(nodeRes.status).toBe(200);
    expect(nodeRes.body.data.node.status).toBe('retired');
  });

  it('admin POST /nodes/:id/retire → Heartbeat danach 401', async () => {
    const { nodeId, nodeCredential } = await performEnroll(adminToken, '-retire-hb');

    // Retire
    const retireRes = await as(adminToken)
      .post(`${BASE}/nodes/${nodeId}/retire`, { reason: 'retire-hb-test' });
    expect(retireRes.status).toBe(200); // RED

    // Heartbeat nach Retire: Credential ist revoked → 401
    const hbRes = await request(app)
      .post(`${BASE}/nodes/${nodeId}/heartbeat`)
      .set('Authorization', `Bearer ${nodeCredential}`)
      .send({ status: 'healthy' });
    expect(hbRes.status).toBe(401);
  });

  it('admin POST /nodes/unknown/retire → 404', async () => {
    const res = await as(adminToken)
      .post(`${BASE}/nodes/00000000-0000-0000-0000-000000000000/retire`, {});
    // RED: Route fehlt. Wenn gebaut: 404 für unbekannte Node.
    expect(res.status).toBe(404);
  });
});

// ─── E. GET /nodes/:id/credentials (NEUE Route) ──────────────────────────────
//
// Neue Route: GET /provisioning/nodes/:id/credentials
//   requireAuth + requireRole('admin')
//   liefert Array<CredentialJSON> OHNE tokenHash/Klartext.

describe('E — GET /nodes/:id/credentials', () => {
  it('ohne Auth → 401', async () => {
    const res = await request(app).get(`${BASE}/nodes/some-id/credentials`);
    expect(res.status).toBe(401);
  });

  it('analyst GET /nodes/:id/credentials → 403', async () => {
    const res = await as(analystToken).get(`${BASE}/nodes/some-id/credentials`);
    // RED: Route fehlt.
    expect(res.status).toBe(403);
  });

  it('admin GET /nodes/:id/credentials → 200 mit credentials-Array', async () => {
    const { nodeId, nodeCredential } = await performEnroll(adminToken, '-get-creds');

    const res = await as(adminToken).get(`${BASE}/nodes/${nodeId}/credentials`);
    // RED: Route fehlt.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('credentials-Response enthält KEINEN tokenHash/Klartext', async () => {
    const { nodeId, nodeCredential } = await performEnroll(adminToken, '-get-creds-safe');

    const res = await as(adminToken).get(`${BASE}/nodes/${nodeId}/credentials`);
    expect(res.status).toBe(200); // RED

    const dump = JSON.stringify(res.body.data);
    // Kein Klartext-Credential
    expect(dump.includes(nodeCredential)).toBe(false);
    expect(dump).not.toMatch(/tokenHash/i);
    expect(dump).not.toMatch(/ncr_[0-9a-f]{64}/);

    // Kein verbotener Key-Name in den Credential-Objekten
    for (const cred of res.body.data) {
      expect(hasSecretKey(cred)).toBe(false);
      expect(cred).toHaveProperty('id');
      expect(cred).toHaveProperty('nodeId', nodeId);
      expect(cred).toHaveProperty('status');
      expect(cred).toHaveProperty('prefix');
    }
  });

  it('GET /nodes/unknown/credentials → 404 oder []', async () => {
    const res = await as(adminToken).get(`${BASE}/nodes/00000000-0000-0000-0000-000000000000/credentials`);
    // RED: Route fehlt. Wenn gebaut: entweder 404 oder 200 mit leerem Array.
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.data).toEqual([]);
    }
  });
});

// ─── F. No-Apply-Safety: neue Routen dürfen keine Apply-Pfade einführen ────────

describe('F — No-Apply-Safety: neue Credential/Retire-Routen', () => {
  it('kein registrierter Routenpfad enthält apply/exec/ssh/firewall/nat/route/dhcp/sniff', () => {
    const provisioningRouter = require('../../src/routes/provisioning');
    const forbidden = /(apply|exec|ssh|remote|shell|firewall|nat|route|routing|dhcp|sniff)/i;
    const paths = provisioningRouter.stack
      .filter((l) => l.route)
      .map((l) => l.route.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => forbidden.test(p))).toEqual([]);
  });
});
