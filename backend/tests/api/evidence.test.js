'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let analystToken, viewerToken;
beforeAll(async () => {
  const a = `ev-analyst-${Date.now()}@x.io`;
  await authService.register({ email: a, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: a, password: 'Test1234!' })).body.token;
  const v = `ev-viewer-${Date.now()}@x.io`;
  await authService.register({ email: v, password: 'Test1234!', displayName: 'V', role: 'viewer' });
  viewerToken = (await request(app).post('/api/v1/auth/login').send({ email: v, password: 'Test1234!' })).body.token;
});

const post = (body, tok = analystToken) => request(app).post('/api/v1/evidence').set('Authorization', `Bearer ${tok}`).send(body);
const get = (url, tok = analystToken) => request(app).get(url).set('Authorization', `Bearer ${tok}`);

describe('Evidence-Store', () => {
  test('POST legt Evidence-Item an (201) + GET nach Ticket', async () => {
    const res = await post({ ticketId: 'T-100', type: 'other', source: 'threatIntel', title: 'TI: 8.8.8.8 (clean)', rawText: '{"verdict":"clean"}', confidence: 60 });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.ticketId).toBe('T-100');
    expect(res.body.data.source).toBe('threatIntel');
    expect(res.body.data.sha256).toMatch(/^[a-f0-9]{64}$/); // Integritäts-Hash

    const list = await get('/api/v1/evidence?ticketId=T-100');
    expect(list.status).toBe(200);
    expect(list.body.data.some((e) => e.title.includes('8.8.8.8'))).toBe(true);
  });

  test('POST ohne title → 400', async () => {
    const res = await post({ ticketId: 'T-101' });
    expect(res.status).toBe(400);
  });

  test('POST ohne ticketId → 400', async () => {
    const res = await post({ title: 'x' });
    expect(res.status).toBe(400);
  });

  test('viewer darf NICHT anlegen → 403', async () => {
    const res = await post({ ticketId: 'T-102', title: 'x' }, viewerToken);
    expect(res.status).toBe(403);
  });

  test('Export liefert Evidence-Paket inkl. Integritätsprüfung', async () => {
    await post({ ticketId: 'T-EXP', type: 'process', source: 'sysmon', title: 'powershell', rawText: 'cmd /c whoami' });
    await post({ ticketId: 'T-EXP', type: 'other', source: 'threatIntel', title: 'TI 1.2.3.4', rawText: '{}' });
    const res = await request(app).post('/api/v1/evidence/export').set('Authorization', `Bearer ${analystToken}`).send({ ticketId: 'T-EXP' });
    expect(res.status).toBe(200);
    expect(res.body.data.ticketId).toBe('T-EXP');
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.integrityOk).toBe(true);
    expect(res.body.data.items.every((i) => i.integrityValid)).toBe(true);
  });

  test('Export ohne ticketId → 400', async () => {
    const res = await request(app).post('/api/v1/evidence/export').set('Authorization', `Bearer ${analystToken}`).send({});
    expect(res.status).toBe(400);
  });

  test('GET /:id unbekannt → 404', async () => {
    const res = await get('/api/v1/evidence/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/evidence');
    expect(res.status).toBe(401);
  });
});

describe('Evidence — Output-as-Evidence + Datei-Import', () => {
  test('POST ai_output legt KI-Output als Evidence an (201)', async () => {
    const res = await post({ ticketId: 'T-AI', type: 'ai_output', source: 'agent', title: 'KI-Verdict: confirmed_incident', rawText: 'Begründung …' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('ai_output');
  });

  test('POST hunt_finding legt Hunt-Finding als Evidence an (201)', async () => {
    const res = await post({ ticketId: 'T-HUNT', type: 'hunt_finding', source: 'threatHunting', title: 'PowerShell-Hunt: 3 Treffer', rawText: '...' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('hunt_finding');
  });

  test('POST file_upload speichert content als rawText + filename (201)', async () => {
    const res = await post({ ticketId: 'T-FILE', type: 'file_upload', source: 'manual', title: 'Import alert.log', filename: 'alert.log', content: 'line1\nline2' });
    expect(res.status).toBe(201);
    expect(res.body.data.filename).toBe('alert.log');
    expect(res.body.data.rawText).toBe('line1\nline2');
  });

  test('POST file_upload mit verbotener Endung → 400', async () => {
    const res = await post({ ticketId: 'T-FILE2', type: 'file_upload', source: 'manual', title: 'Import', filename: 'evil.exe', content: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Dateityp/);
  });
});

describe('Evidence — Chain of Custody', () => {
  let evId;
  beforeAll(async () => {
    const r = await post({ ticketId: 'T-CU', type: 'process', source: 'sysmon', title: 'powershell', rawText: 'x' });
    evId = r.body.data.id;
  });

  test('reviewed → reviewStatus reviewed; verified → verified; Log akkumuliert', async () => {
    const r1 = await request(app).post(`/api/v1/evidence/${evId}/custody`).set('Authorization', `Bearer ${analystToken}`).send({ action: 'reviewed', note: 'gesichtet' });
    expect(r1.status).toBe(201);
    expect(r1.body.data.reviewStatus).toBe('reviewed');
    expect(r1.body.data.custody).toHaveLength(1);

    const r2 = await request(app).post(`/api/v1/evidence/${evId}/custody`).set('Authorization', `Bearer ${analystToken}`).send({ action: 'verified' });
    expect(r2.body.data.reviewStatus).toBe('verified');
    expect(r2.body.data.custody).toHaveLength(2);
  });

  test('GET /:id liefert custody + reviewStatus', async () => {
    const res = await get(`/api/v1/evidence/${evId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.reviewStatus).toBe('verified');
    expect(Array.isArray(res.body.data.custody)).toBe(true);
  });

  test('viewer darf NICHT protokollieren → 403', async () => {
    const res = await request(app).post(`/api/v1/evidence/${evId}/custody`).set('Authorization', `Bearer ${viewerToken}`).send({ action: 'reviewed' });
    expect(res.status).toBe(403);
  });

  test('custody auf unbekannter Evidence → 404', async () => {
    const res = await request(app).post('/api/v1/evidence/nope/custody').set('Authorization', `Bearer ${analystToken}`).send({ action: 'reviewed' });
    expect(res.status).toBe(404);
  });
});
