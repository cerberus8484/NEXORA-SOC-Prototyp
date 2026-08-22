'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { authService }  = require('../../src/services/AuthService');
const { ticketService } = require('../../src/services/TicketService');
const { huntService }  = require('../../src/threatHunting/services/huntServiceInstance');

const BASE = '/api/v1/hunts';

let analystToken;
let viewerToken;

beforeEach(async () => {
  huntService._repo.clear();
  ticketService._repo.clear();
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
});

const as = (token) => ({
  get:  (url)       => request(app).get(url).set('Authorization',  `Bearer ${token}`),
  post: (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body || {}),
});

async function setupHunt() {
  const ticket  = await ticketService.create({ title: 'SOC Ticket', priority: 'high' });
  const sRes    = await as(analystToken).post(BASE, { targetHost: '10.0.0.5', scope: 'Hunt' });
  const sid     = sRes.body.data.id;
  return { ticketId: ticket.id, sid };
}

async function createFinding(sid) {
  const res = await as(analystToken).post(`${BASE}/${sid}/findings`, {
    title: 'Reverse Shell', severity: 'high', confidence: 'high',
  });
  return res.body.data.id;
}

async function createArtifact(sid) {
  const res = await as(analystToken).post(`${BASE}/${sid}/artifacts`, {
    type: 'ioc', value: '185.220.101.5',
  });
  return res.body.data.id;
}

// ─── Create Findings / Artifacts ──────────────────────────────────────────────

describe('POST /api/v1/hunts/:id/findings', () => {
  it('Analyst legt Finding an → 201', async () => {
    const { sid } = await setupHunt();
    const res = await as(analystToken).post(`${BASE}/${sid}/findings`, {
      title: 'Suspicious PowerShell', severity: 'critical', confidence: 'high', mitreAttack: 'T1059.001',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.severity).toBe('critical');
    expect(res.body.data.ticketId).toBeNull();
  });

  it('Viewer darf kein Finding anlegen → 403', async () => {
    const { sid } = await setupHunt();
    const res = await as(viewerToken).post(`${BASE}/${sid}/findings`, { title: 'x', severity: 'low' });
    expect(res.status).toBe(403);
  });

  it('Ungültige Severity → 400', async () => {
    const { sid } = await setupHunt();
    const res = await as(analystToken).post(`${BASE}/${sid}/findings`, { title: 'x', severity: 'EXTREME' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/hunts/:id/artifacts', () => {
  it('Analyst legt Artifact an → 201', async () => {
    const { sid } = await setupHunt();
    const res = await as(analystToken).post(`${BASE}/${sid}/artifacts`, {
      type: 'file', value: 'c:\\temp\\beacon.exe', metadata: { hash: 'abc' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('file');
  });

  it('Ungültiger Typ → 400', async () => {
    const { sid } = await setupHunt();
    const res = await as(analystToken).post(`${BASE}/${sid}/artifacts`, { type: 'bogus', value: 'x' });
    expect(res.status).toBe(400);
  });
});

// ─── Link Finding → Ticket ────────────────────────────────────────────────────

describe('POST /api/v1/hunts/:id/findings/:findingId/link-ticket', () => {
  it('verlinkt Finding mit Ticket → 201', async () => {
    const { sid, ticketId } = await setupHunt();
    const fid = await createFinding(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/findings/${fid}/link-ticket`, { ticketId });
    expect(res.status).toBe(201);
    expect(res.body.data.sourceType).toBe('finding');
    expect(res.body.data.ticketId).toBe(ticketId);
  });

  it('idempotent — zweiter Link liefert denselben Datensatz, kein Duplikat', async () => {
    const { sid, ticketId } = await setupHunt();
    const fid = await createFinding(sid);
    await as(analystToken).post(`${BASE}/${sid}/findings/${fid}/link-ticket`, { ticketId });
    await as(analystToken).post(`${BASE}/${sid}/findings/${fid}/link-ticket`, { ticketId });
    const links = await as(viewerToken).get(`${BASE}/${sid}/ticket-links`);
    expect(links.body.data.length).toBe(1);
  });

  it('unbekanntes Ticket → 404', async () => {
    const { sid } = await setupHunt();
    const fid = await createFinding(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/findings/${fid}/link-ticket`, { ticketId: 'ghost' });
    expect(res.status).toBe(404);
  });

  it('unbekanntes Finding → 404', async () => {
    const { sid, ticketId } = await setupHunt();
    const res = await as(analystToken).post(`${BASE}/${sid}/findings/ghost/link-ticket`, { ticketId });
    expect(res.status).toBe(404);
  });

  it('fehlende ticketId → 400', async () => {
    const { sid } = await setupHunt();
    const fid = await createFinding(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/findings/${fid}/link-ticket`, {});
    expect(res.status).toBe(400);
  });

  it('Viewer darf nicht verlinken → 403', async () => {
    const { sid, ticketId } = await setupHunt();
    const fid = await createFinding(sid);
    const res = await as(viewerToken).post(`${BASE}/${sid}/findings/${fid}/link-ticket`, { ticketId });
    expect(res.status).toBe(403);
  });
});

// ─── Link Artifact → Ticket ───────────────────────────────────────────────────

describe('POST /api/v1/hunts/:id/artifacts/:artifactId/link-ticket', () => {
  it('verlinkt Artifact mit Ticket → 201', async () => {
    const { sid, ticketId } = await setupHunt();
    const aid = await createArtifact(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/artifacts/${aid}/link-ticket`, { ticketId });
    expect(res.status).toBe(201);
    expect(res.body.data.sourceType).toBe('artifact');
    expect(res.body.data.summary).toContain('185.220.101.5');
  });

  it('unbekanntes Artifact → 404', async () => {
    const { sid, ticketId } = await setupHunt();
    const res = await as(analystToken).post(`${BASE}/${sid}/artifacts/ghost/link-ticket`, { ticketId });
    expect(res.status).toBe(404);
  });
});

// ─── Link Summary → Ticket ────────────────────────────────────────────────────

describe('POST /api/v1/hunts/:id/link-summary-to-ticket', () => {
  it('verlinkt Session-Summary mit Ticket → 201', async () => {
    const { sid, ticketId } = await setupHunt();
    await createFinding(sid);
    await createArtifact(sid);
    const res = await as(analystToken).post(`${BASE}/${sid}/link-summary-to-ticket`, { ticketId });
    expect(res.status).toBe(201);
    expect(res.body.data.sourceType).toBe('summary');
    expect(res.body.data.summary).toContain('Findings: 1');
  });

  it('unbekannte Session → 404', async () => {
    const { ticketId } = await setupHunt();
    const res = await as(analystToken).post(`${BASE}/ghost/link-summary-to-ticket`, { ticketId });
    expect(res.status).toBe(404);
  });
});

// ─── GET ticket-links ─────────────────────────────────────────────────────────

describe('GET /api/v1/hunts/:id/ticket-links', () => {
  it('Viewer sieht alle Links der Session', async () => {
    const { sid, ticketId } = await setupHunt();
    const fid = await createFinding(sid);
    const aid = await createArtifact(sid);
    await as(analystToken).post(`${BASE}/${sid}/findings/${fid}/link-ticket`, { ticketId });
    await as(analystToken).post(`${BASE}/${sid}/artifacts/${aid}/link-ticket`, { ticketId });
    await as(analystToken).post(`${BASE}/${sid}/link-summary-to-ticket`, { ticketId });

    const res = await as(viewerToken).get(`${BASE}/${sid}/ticket-links`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
  });

  it('leere Liste wenn keine Links → 200', async () => {
    const { sid } = await setupHunt();
    const res = await as(viewerToken).get(`${BASE}/${sid}/ticket-links`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
