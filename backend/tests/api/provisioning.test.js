'use strict';

// P_AGENT_1 — /api/v1/provisioning Routes: Admin-RBAC + Node-Enroll/Heartbeat-Flow.
const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const provisioningRouter = require('../../src/routes/provisioning');

let adminToken; let analystToken;

async function mkUser(role) {
  const email = `prov-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}

const as = (t) => ({
  get:  (u)    => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

const BASE = '/api/v1/provisioning';

beforeAll(async () => {
  adminToken = await mkUser('admin');
  analystToken = await mkUser('analyst');
});

describe('Provisioning Routes — Admin-RBAC', () => {
  it('POST /enrollment-profiles ohne Auth → 401', async () => {
    expect((await request(app).post(`${BASE}/enrollment-profiles`).send({ name: 'x', role: 'normal_agent' })).status).toBe(401);
  });
  it('analyst POST /enrollment-profiles → 403', async () => {
    expect((await as(analystToken).post(`${BASE}/enrollment-profiles`, { name: 'x', role: 'normal_agent' })).status).toBe(403);
  });
  it('admin POST /enrollment-profiles → 201', async () => {
    const res = await as(adminToken).post(`${BASE}/enrollment-profiles`, { name: 'lab', role: 'network_sensor', capabilities: ['inventory'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.status).toBe('active');
  });
});

describe('Provisioning Routes — Token-Mint + Enroll + Heartbeat (Flow)', () => {
  let profileId; let enrollToken; let nodeId; let nodeCredential;

  it('admin mintet Token — Klartext einmalig, kein Hash in Response', async () => {
    profileId = (await as(adminToken).post(`${BASE}/enrollment-profiles`, { name: 'flow', role: 'normal_agent', capabilities: ['inventory', 'heartbeat'] })).body.data.id;
    const res = await as(adminToken).post(`${BASE}/enrollment-profiles/${profileId}/token`, {});
    expect(res.status).toBe(201);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.startsWith('enr_')).toBe(true);
    expect(res.body.data.enrollmentToken).not.toHaveProperty('tokenHash');
    enrollToken = res.body.data.token;
  });

  it('Node enrollt mit Token (im Body) → 201 nodeId + nodeCredential (einmalig)', async () => {
    const res = await request(app).post(`${BASE}/enroll`).send({ token: enrollToken, hostname: 'dc01', platform: 'Windows', ips: ['10.99.99.10'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('nodeId');
    expect(res.body.data).toHaveProperty('serverTime');
    expect(typeof res.body.data.nodeCredential).toBe('string');
    expect(res.body.data.nodeCredential.startsWith('ncr_')).toBe(true);
    nodeId = res.body.data.nodeId;
    nodeCredential = res.body.data.nodeCredential;
  });

  it('Enroll mit falschem Token → 401', async () => {
    const res = await request(app).post(`${BASE}/enroll`).send({ token: 'enr_falsch', hostname: 'dc01' });
    expect(res.status).toBe(401);
  });

  it('Enrollment-Token ist einmalig — zweiter Enroll mit gleichem Token → 401', async () => {
    const res = await request(app).post(`${BASE}/enroll`).send({ token: enrollToken, hostname: 'dc01' });
    expect(res.status).toBe(401);
  });

  it('Heartbeat (Bearer Node-Credential) → 200 accepted, keine Commands/Apply', async () => {
    const res = await request(app).post(`${BASE}/nodes/${nodeId}/heartbeat`)
      .set('Authorization', `Bearer ${nodeCredential}`).send({ status: 'healthy', version: '1.1' });
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(true);
    expect(JSON.stringify(res.body.data)).not.toMatch(/(command|apply|exec|ssh|firewall|nat|route|dhcp|sniff)/i);
  });

  it('Heartbeat mit Enrollment-Token (statt Node-Credential) → 401', async () => {
    const res = await request(app).post(`${BASE}/nodes/${nodeId}/heartbeat`)
      .set('Authorization', `Bearer ${enrollToken}`).send({ status: 'healthy' });
    expect(res.status).toBe(401);
  });

  it('Heartbeat ohne Credential → 401', async () => {
    const res = await request(app).post(`${BASE}/nodes/${nodeId}/heartbeat`).send({ status: 'healthy' });
    expect(res.status).toBe(401);
  });

  it('Heartbeat mit Credential gegen fremde Node (Bindung) → 403', async () => {
    const res = await request(app).post(`${BASE}/nodes/00000000-0000-0000-0000-000000000000/heartbeat`)
      .set('Authorization', `Bearer ${nodeCredential}`).send({ status: 'healthy' });
    expect(res.status).toBe(403);
  });
});

describe('Provisioning Routes — Registry-Sicht (read-only, admin)', () => {
  let enrollToken; let nodeId;

  beforeAll(async () => {
    const profileId = (await as(adminToken).post(`${BASE}/enrollment-profiles`, { name: 'reg', role: 'normal_agent', capabilities: ['inventory'] })).body.data.id;
    enrollToken = (await as(adminToken).post(`${BASE}/enrollment-profiles/${profileId}/token`, {})).body.data.token;
    const enrolled = (await request(app).post(`${BASE}/enroll`).send({ token: enrollToken, hostname: 'reg-host', ips: ['10.99.99.20'] })).body.data;
    nodeId = enrolled.nodeId;
    // Heartbeat ausschließlich mit dem Node-Credential (nicht dem Enrollment-Token).
    await request(app).post(`${BASE}/nodes/${nodeId}/heartbeat`).set('Authorization', `Bearer ${enrolled.nodeCredential}`).send({ status: 'healthy' });
  });

  it('GET /nodes ohne Auth → 401', async () => {
    expect((await request(app).get(`${BASE}/nodes`)).status).toBe(401);
  });
  it('analyst GET /nodes → 403', async () => {
    expect((await as(analystToken).get(`${BASE}/nodes`)).status).toBe(403);
  });
  it('admin GET /nodes → 200 { data, total }, enthält den Node', async () => {
    const res = await as(adminToken).get(`${BASE}/nodes`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((n) => n.id === nodeId)).toBe(true);
  });
  it('admin GET /nodes/:id → 200 mit node + capabilities + heartbeats + latestHeartbeat', async () => {
    const res = await as(adminToken).get(`${BASE}/nodes/${nodeId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.node.id).toBe(nodeId);
    expect(Array.isArray(res.body.data.capabilities)).toBe(true);
    expect(Array.isArray(res.body.data.heartbeats)).toBe(true);
    expect(res.body.data.latestHeartbeat.status).toBe('healthy');
  });
  it('admin GET /nodes/:id unbekannt → 404', async () => {
    expect((await as(adminToken).get(`${BASE}/nodes/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
  });
  it('admin GET /audit → 200, enthält node.enrolled-Event', async () => {
    const res = await as(adminToken).get(`${BASE}/audit?subjectId=${nodeId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => e.type)).toContain('node.enrolled');
  });
});

describe('Provisioning Routes — No-Apply-Safety (keine apply/exec/... Pfade)', () => {
  it('kein registrierter Routenpfad heißt apply/exec/ssh/firewall/nat/route/dhcp/sniff', () => {
    const forbidden = /(apply|exec|ssh|remote|shell|firewall|nat|route|routing|dhcp|sniff)/i;
    const paths = provisioningRouter.stack.filter((l) => l.route).map((l) => l.route.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => forbidden.test(p))).toEqual([]);
  });
});
