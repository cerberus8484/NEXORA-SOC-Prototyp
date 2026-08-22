'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { huntService }  = require('../../src/threatHunting/services/huntServiceInstance');

const BASE = '/api/v1/hunts';

let analystToken;
let viewerToken;
let adminToken;

beforeEach(async () => {
  huntService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();

  const aEmail = `analyst-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  const aRes = await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' });
  analystToken = aRes.body.token;

  const vEmail = `viewer-${Date.now()}@test.soc`;
  await authService.register({ email: vEmail, password: 'Test1234!', displayName: 'Viewer', role: 'viewer' });
  const vRes = await request(app).post('/api/v1/auth/login').send({ email: vEmail, password: 'Test1234!' });
  viewerToken = vRes.body.token;

  const dEmail = `admin-${Date.now()}@test.soc`;
  await authService.register({ email: dEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  const dRes = await request(app).post('/api/v1/auth/login').send({ email: dEmail, password: 'Test1234!' });
  adminToken = dRes.body.token;
});

const as = (token) => ({
  get:  (url)       => request(app).get(url).set('Authorization',  `Bearer ${token}`),
  post: (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body || {}),
});

async function createSession() {
  const res = await as(analystToken).post(BASE, { targetHost: '10.0.0.5', scope: 'Hunt' });
  return res.body.data.id;
}

async function createCommand(sessionId) {
  const res = await as(analystToken).post(`${BASE}/${sessionId}/commands`, {
    type: 'osquery', command: 'SELECT * FROM processes', description: 'Prozesse',
  });
  return res.body.data.id;
}

// ─── POST /v1/hunts/:id/commands ─────────────────────────────────────────────

describe('POST /api/v1/hunts/:id/commands', () => {
  it('Analyst legt Command an → 201 + queued', async () => {
    const sid = await createSession();
    const res = await as(analystToken).post(`${BASE}/${sid}/commands`, {
      type: 'manual', command: 'netstat -an', description: 'Netzwerkverbindungen prüfen',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.type).toBe('manual');
    expect(res.body.data.command).toBe('netstat -an');
    expect(res.body.data.stdout).toBe('');
    expect(res.body.data.exitCode).toBeNull();
  });

  it('Viewer kann keinen Command anlegen → 403', async () => {
    const sid = await createSession();
    const res = await as(viewerToken).post(`${BASE}/${sid}/commands`, { type: 'manual', command: 'x' });
    expect(res.status).toBe(403);
  });

  it('Unbekannte Session → 404', async () => {
    const res = await as(analystToken).post(`${BASE}/ghost/commands`, { type: 'manual', command: 'x' });
    expect(res.status).toBe(404);
  });

  it('Fehlender type → 400', async () => {
    const sid = await createSession();
    const res = await as(analystToken).post(`${BASE}/${sid}/commands`, { command: 'x' });
    expect(res.status).toBe(400);
  });

  it('Ungültiger type → 400', async () => {
    const sid = await createSession();
    const res = await as(analystToken).post(`${BASE}/${sid}/commands`, { type: 'rm -rf', command: 'x' });
    expect(res.status).toBe(400);
  });

  it('Leeres command → 400', async () => {
    const sid = await createSession();
    const res = await as(analystToken).post(`${BASE}/${sid}/commands`, { type: 'manual', command: '' });
    expect(res.status).toBe(400);
  });
});

// ─── GET /v1/hunts/:id/commands ───────────────────────────────────────────────

describe('GET /api/v1/hunts/:id/commands', () => {
  it('gibt alle Commands zurück', async () => {
    const sid = await createSession();
    await as(analystToken).post(`${BASE}/${sid}/commands`, { type: 'manual', command: 'ls' });
    await as(analystToken).post(`${BASE}/${sid}/commands`, { type: 'sigma', command: 'detection: ...' });
    const res = await as(viewerToken).get(`${BASE}/${sid}/commands`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('Unbekannte Session → 404', async () => {
    const res = await as(viewerToken).get(`${BASE}/ghost/commands`);
    expect(res.status).toBe(404);
  });
});

// ─── GET /v1/hunts/:id/commands/:commandId ────────────────────────────────────

describe('GET /api/v1/hunts/:id/commands/:commandId', () => {
  it('gibt einzelnen Command zurück', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    const res = await as(viewerToken).get(`${BASE}/${sid}/commands/${cid}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(cid);
  });

  it('Unbekannte commandId → 404', async () => {
    const sid = await createSession();
    const res = await as(viewerToken).get(`${BASE}/${sid}/commands/ghost-cmd`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /v1/hunts/:id/commands/:commandId/start ─────────────────────────────

describe('POST commands/:commandId/start', () => {
  it('Analyst startet Command → running', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/start`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('running');
    expect(res.body.data.executedAt).not.toBeNull();
  });

  it('doppeltes start → 409', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/start`);
    const res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/start`);
    expect(res.status).toBe(409);
  });

  it('Viewer kann nicht starten → 403', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    const res = await as(viewerToken).post(`${BASE}/${sid}/commands/${cid}/start`);
    expect(res.status).toBe(403);
  });
});

// ─── POST /v1/hunts/:id/commands/:commandId/complete ─────────────────────────

describe('POST commands/:commandId/complete', () => {
  it('running → completed mit stdout + exitCode', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/start`);
    const res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/complete`, {
      stdout: 'PID 1337 gesehen', exitCode: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.stdout).toBe('PID 1337 gesehen');
    expect(res.body.data.exitCode).toBe(0);
    expect(res.body.data.completedAt).not.toBeNull();
  });

  it('queued → complete → 409', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/complete`, {});
    expect(res.status).toBe(409);
  });
});

// ─── POST /v1/hunts/:id/commands/:commandId/fail ─────────────────────────────

describe('POST commands/:commandId/fail', () => {
  it('running → failed mit reason', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/start`);
    const res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/fail`, {
      reason: 'Timeout', exitCode: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('failed');
    expect(res.body.data.result).toBe('Timeout');
    expect(res.body.data.exitCode).toBe(1);
  });
});

// ─── POST /v1/hunts/:id/commands/:commandId/block ────────────────────────────

describe('POST commands/:commandId/block', () => {
  it('nur Admin kann blockieren', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/block`, { reason: 'x' });
    expect(res.status).toBe(403);
  });

  it('Admin blockiert queued Command', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    const res = await as(adminToken).post(`${BASE}/${sid}/commands/${cid}/block`, {
      reason: 'Genehmigung ausstehend',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('blocked');
    expect(res.body.data.blockedReason).toBe('Genehmigung ausstehend');
  });
});

// ─── POST /v1/hunts/:id/commands/:commandId/requeue ──────────────────────────

describe('POST commands/:commandId/requeue', () => {
  it('blocked → queued', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    await as(adminToken).post(`${BASE}/${sid}/commands/${cid}/block`, { reason: 'warte' });
    const res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/requeue`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.blockedReason).toBe('');
  });

  it('queued → requeue → 409', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/requeue`);
    expect(res.status).toBe(409);
  });
});

// ─── Vollständiger Lifecycle via API ─────────────────────────────────────────

describe('Command Lifecycle — End-to-End via API', () => {
  it('queued → blocked → requeued → running → completed', async () => {
    const sid = await createSession();
    const cid = await createCommand(sid);

    // block
    let res = await as(adminToken).post(`${BASE}/${sid}/commands/${cid}/block`, { reason: 'Review' });
    expect(res.body.data.status).toBe('blocked');

    // requeue
    res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/requeue`);
    expect(res.body.data.status).toBe('queued');

    // start
    res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/start`);
    expect(res.body.data.status).toBe('running');

    // complete
    res = await as(analystToken).post(`${BASE}/${sid}/commands/${cid}/complete`, {
      stdout: 'Ergebnis', exitCode: 0,
    });
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.stdout).toBe('Ergebnis');
  });
});
