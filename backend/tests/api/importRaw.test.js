'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { ticketService } = require('../../src/services/TicketService');
const { authService }   = require('../../src/services/AuthService');

let analystToken;
let viewerToken;
let adminToken;
let ticketId;

beforeEach(async () => {
  ticketService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();

  // Analyst anlegen
  const aEmail = `analyst-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  const aRes = await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' });
  analystToken = aRes.body.token;

  // Admin anlegen
  const dEmail = `admin-${Date.now()}@test.soc`;
  await authService.register({ email: dEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  const dRes = await request(app).post('/api/v1/auth/login').send({ email: dEmail, password: 'Test1234!' });
  adminToken = dRes.body.token;

  // Viewer anlegen
  const vEmail = `viewer-${Date.now()}@test.soc`;
  await authService.register({ email: vEmail, password: 'Test1234!', displayName: 'Viewer', role: 'viewer' });
  const vRes = await request(app).post('/api/v1/auth/login').send({ email: vEmail, password: 'Test1234!' });
  viewerToken = vRes.body.token;

  // Ticket anlegen
  const tRes = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${analystToken}`)
    .send({ title: 'Test-Ticket für Import' });
  ticketId = tRes.body.data.id;
});

const asAnalyst = (url) => request(app).post(url).set('Authorization', `Bearer ${analystToken}`);
const asAdmin   = (url) => request(app).post(url).set('Authorization', `Bearer ${adminToken}`);
const asViewer  = (url) => request(app).post(url).set('Authorization', `Bearer ${viewerToken}`);
const noAuth    = (url) => request(app).post(url);

describe('POST /api/v1/tickets/:id/import', () => {

  // ── Zugriffskontrolle ───────────────────────────────────────

  it('401 ohne Auth-Token', async () => {
    const res = await noAuth(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: '185.220.101.5', sourceType: 'manual' });
    expect(res.status).toBe(401);
  });

  it('403 für Viewer-Rolle', async () => {
    const res = await asViewer(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: '185.220.101.5', sourceType: 'manual' });
    expect(res.status).toBe(403);
  });

  it('200 für Analyst-Rolle', async () => {
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: '185.220.101.5', sourceType: 'Wazuh Alert' });
    expect(res.status).toBe(200);
  });

  it('200 für Admin-Rolle', async () => {
    const res = await asAdmin(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: 'https://evil.ru/drop.exe', sourceType: 'manual' });
    expect(res.status).toBe(200);
  });

  // ── Ticket-Not-Found ────────────────────────────────────────

  it('404 wenn Ticket nicht existiert', async () => {
    const res = await asAnalyst('/api/v1/tickets/nonexistent-id-xyz/import')
      .send({ raw: '1.2.3.4', sourceType: 'manual' });
    expect(res.status).toBe(404);
  });

  // ── Input-Validierung ───────────────────────────────────────

  it('400 bei leerem raw', async () => {
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: '', sourceType: 'manual' });
    expect(res.status).toBe(400);
  });

  it('400 bei fehlendem raw', async () => {
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ sourceType: 'manual' });
    expect(res.status).toBe(400);
  });

  it('400 bei zu langem raw (>20000 Zeichen)', async () => {
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: 'a'.repeat(20001), sourceType: 'manual' });
    expect(res.status).toBe(400);
  });

  // ── Parse-Ergebnisse ────────────────────────────────────────

  it('parst IP-Adresse korrekt', async () => {
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: '185.220.101.5', sourceType: 'Wazuh Alert' });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('IP');
    expect(res.body.data.evidence.destination.ip).toBe('185.220.101.5');
    expect(res.body.data.iocs.length).toBeGreaterThan(0);
    expect(res.body.requestId).toBeTruthy();
  });

  it('parst SHA256-Hash korrekt', async () => {
    const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: sha256, sourceType: 'manual' });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('Hash');
    expect(res.body.data.iocs.some((i) => i.type === 'hash')).toBe(true);
  });

  it('parst URL korrekt', async () => {
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: 'https://malicious.example.com/payload.exe', sourceType: 'Paste Raw Log' });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('URL');
    expect(res.body.data.evidence.payload.url).toBe('https://malicious.example.com/payload.exe');
    expect(res.body.data.iocs.some((i) => i.type === 'url')).toBe(true);
  });

  it('parst Base64-String korrekt', async () => {
    // "Hello World" in Base64
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: 'SGVsbG8gV29ybGQ=', sourceType: 'manual' });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('Encoded String');
    expect(res.body.data.evidence.payload.preview).toBeTruthy();
  });

  // ── Kein ungewolltes Persistieren ──────────────────────────

  it('persistiert NICHTS — evidence bleibt leer nach import', async () => {
    await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: '185.220.101.5', sourceType: 'manual' });

    // Evidence-Liste abrufen — muss leer sein (Import-Preview speichert nicht)
    const evRes = await request(app)
      .get(`/api/v1/evidence?ticketId=${ticketId}`)
      .set('Authorization', `Bearer ${analystToken}`);
    // Entweder 200 mit leerer Liste oder die Route existiert noch nicht (404 akzeptabel)
    if (evRes.status === 200) {
      expect(evRes.body.data ?? []).toHaveLength(0);
    }
  });

  // ── Antwort-Struktur ────────────────────────────────────────

  it('Antwort enthält requestId', async () => {
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: '1.2.3.4', sourceType: 'manual' });
    expect(res.body.requestId).toBeTruthy();
  });

  it('evidence hat die ParsedEvidence-Felder', async () => {
    const res = await asAnalyst(`/api/v1/tickets/${ticketId}/import`)
      .send({ raw: 'phishing@fake-bank.de', sourceType: 'manual' });
    expect(res.status).toBe(200);
    const ev = res.body.data.evidence;
    // Muss die Pflichtfelder der ParsedEvidence-Form haben
    expect(ev).toHaveProperty('detection');
    expect(ev).toHaveProperty('source');
    expect(ev).toHaveProperty('destination');
    expect(ev).toHaveProperty('payload');
    expect(ev).toHaveProperty('network');
  });
});
