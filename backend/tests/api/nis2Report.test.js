'use strict';

// P_NIS2_2 — /api/v1/nis2 Report + Incident-Evidence Routes: RBAC, Flow, PII-Sicherheit,
// ehrliche Sprache. Nutzt den geteilten ticketService-Singleton (dieselbe Instanz wie die
// Tickets-Route), damit verknüpfte Incidents im InMemory-Modus sichtbar sind.

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { ticketService } = require('../../src/services/TicketService');

const BASE = '/api/v1/nis2';
let adminToken; let viewerToken; let analystToken;

async function mkUser(role) {
  const email = `nis2r-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}
const as = (t) => ({
  get:  (u)    => request(app).get(u).set('Authorization', `Bearer ${t}`),
  post: (u, b) => request(app).post(u).set('Authorization', `Bearer ${t}`).send(b || {}),
});

beforeAll(async () => {
  adminToken = await mkUser('admin');
  viewerToken = await mkUser('viewer');
  analystToken = await mkUser('analyst');
});

describe('GET /nis2/report — Management-Readiness-Report', () => {
  it('ohne Auth → 401', async () => {
    expect((await request(app).get(`${BASE}/report`)).status).toBe(401);
  });
  it('viewer → 200, meta + summary + controls', async () => {
    const res = await as(viewerToken).get(`${BASE}/report`);
    expect(res.status).toBe(200);
    expect(res.body.data.meta.disclaimer).toMatch(/kein Konformitätsnachweis/i);
    expect(res.body.data.summary.controlsTotal).toBe(10);
    expect(res.body.data.controls).toHaveLength(10);
  });
  it('Report enthält KEINEN positiven Compliance-/Zertifizierungs-Claim', async () => {
    const res = await as(viewerToken).get(`${BASE}/report`);
    // Der ehrliche Disclaimer NEGIERT bewusst ("kein Konformitätsnachweis") — das ist erwünscht.
    expect(res.body.data.meta.disclaimer).toMatch(/kein Konformitätsnachweis/i);
    // Verboten sind nur POSITIVE Behauptungen (Wortgrenzen, damit "Zertifizierung"
    // in "keine Zertifizierung" / "Konformität" im negierten Disclaimer nicht fälschlich triggert).
    const dump = JSON.stringify(res.body).toLowerCase();
    expect(dump).not.toMatch(/\b(compliant|zertifiziert|rechtssicher|ist konform)\b/);
  });
});

describe('POST /nis2/controls/:controlKey/incident-evidence', () => {
  it('ohne Auth → 401', async () => {
    const res = await request(app).post(`${BASE}/controls/incident_handling/incident-evidence`).send({ ticketId: 'x' });
    expect(res.status).toBe(401);
  });
  it('analyst → 403 (nur admin schreibt)', async () => {
    const res = await as(analystToken).post(`${BASE}/controls/incident_handling/incident-evidence`, { ticketId: 'x' });
    expect(res.status).toBe(403);
  });
  it('admin ohne ticketId → 400', async () => {
    const res = await as(adminToken).post(`${BASE}/controls/incident_handling/incident-evidence`, {});
    expect(res.status).toBe(400);
  });
  it('admin mit unbekanntem ticketId → 404', async () => {
    const res = await as(adminToken)
      .post(`${BASE}/controls/incident_handling/incident-evidence`, { ticketId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('admin mit echtem Ticket → 201, ticket-Evidence ohne PII', async () => {
    const ticket = await ticketService.create({
      title: 'NIS2 link <x> test', priority: 'high',
      email: 'pii@corp.example', srcIp: '10.9.9.9', user: 'secret-user',
    });
    const res = await as(adminToken)
      .post(`${BASE}/controls/incident_handling/incident-evidence`, { ticketId: ticket.id });
    expect(res.status).toBe(201);
    expect(res.body.data.evidenceType).toBe('ticket');
    expect(res.body.data.evidenceRef).toBe(ticket.ticketNr);
    expect(res.body.data.title).not.toMatch(/[<>]/);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain('pii@corp.example');
    expect(dump).not.toContain('10.9.9.9');
    expect(dump).not.toContain('secret-user');
  });

  it('nach Verknüpfung: Report zählt Incident-Evidence und leakt kein PII', async () => {
    const ticket = await ticketService.create({
      title: 'NIS2 report incident', priority: 'medium', email: 'leak@corp.example', srcIp: '10.8.8.8',
    });
    await as(adminToken).post(`${BASE}/controls/access_control_asset_management/incident-evidence`, { ticketId: ticket.id });
    const res = await as(viewerToken).get(`${BASE}/report`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.incidentEvidenceTotal).toBeGreaterThanOrEqual(1);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain('leak@corp.example');
    expect(dump).not.toContain('10.8.8.8');
  });
});
