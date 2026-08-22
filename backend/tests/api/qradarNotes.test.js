'use strict';

/**
 * API-Tests — QRadar Offense Notes
 *
 * Testet:
 *   POST /api/v1/qradar/offenses/:id/notes — Notiz anlegen
 *   GET  /api/v1/qradar/offenses/:id/notes — Notizen lesen
 *
 * Sicherheits-Invarianten:
 *   - author kommt IMMER aus Token (req.user.sub), NICHT aus dem Body
 *   - leerer content → 400
 *   - zu langer content → 400
 *   - kein Token → 401
 */

const request      = require('supertest');
const app          = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { offenseNoteRepository } = require('../../src/integrations/adapters/qradar/offenseNoteRepositoryFactory');

const BASE = '/api/v1/qradar/offenses';

let analystToken;
let analystUserId;
let viewerToken;

beforeEach(async () => {
  // Repository leeren
  offenseNoteRepository.clear();
  authService._users.clear();
  authService._blocklist.clear();

  // Analyst anlegen und einloggen
  const analystEmail = `analyst-${Date.now()}@test.soc`;
  const analystUser = await authService.register({ email: analystEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  analystUserId = analystUser.id;
  const aRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: analystEmail, password: 'Test1234!' });
  analystToken = aRes.body.token;

  // Viewer anlegen
  const vEmail = `viewer-${Date.now()}@test.soc`;
  await authService.register({ email: vEmail, password: 'Test1234!', displayName: 'Viewer', role: 'viewer' });
  const vRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: vEmail, password: 'Test1234!' });
  viewerToken = vRes.body.token;
});

// Hilfsfunktionen
const as = (token) => ({
  get:  (url)       => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url, body) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body || {}),
});

// ── POST /offenses/:id/notes ─────────────────────────────────────────────────

describe('POST /api/v1/qradar/offenses/:id/notes', () => {
  test('Analyst legt Notiz an → 201 + Notiz im Body', async () => {
    const res = await as(analystToken).post(`${BASE}/42/notes`, { content: 'Erste Analyst-Notiz' });
    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.content).toBe('Erste Analyst-Notiz');
    expect(res.body.data.offenseId).toBe('42');
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.createdAt).toBeTruthy();
    expect(res.body.requestId).toBeTruthy();
  });

  test('author kommt aus Token — NICHT aus dem Body', async () => {
    const res = await as(analystToken).post(`${BASE}/42/notes`, {
      content: 'Notiz',
      author:  'MANIPULIERTER_AUTHOR',  // soll ignoriert werden
    });
    expect(res.status).toBe(201);
    // author muss die User-ID aus dem Token sein (req.user.sub = user.id), nicht der Body-Wert
    expect(res.body.data.author).toBe(analystUserId);
    expect(res.body.data.author).not.toBe('MANIPULIERTER_AUTHOR');
  });

  test('leerer content → 400', async () => {
    const res = await as(analystToken).post(`${BASE}/42/notes`, { content: '' });
    expect(res.status).toBe(400);
  });

  test('nur Whitespace als content → 400', async () => {
    const res = await as(analystToken).post(`${BASE}/42/notes`, { content: '   ' });
    expect(res.status).toBe(400);
  });

  test('content zu lang (>5000 Zeichen) → 400', async () => {
    const res = await as(analystToken).post(`${BASE}/42/notes`, { content: 'x'.repeat(5001) });
    expect(res.status).toBe(400);
  });

  test('fehlender content-Key → 400', async () => {
    const res = await as(analystToken).post(`${BASE}/42/notes`, {});
    expect(res.status).toBe(400);
  });

  test('kein Token → 401', async () => {
    const res = await request(app).post(`${BASE}/42/notes`).send({ content: 'x' });
    expect(res.status).toBe(401);
  });

  test('Viewer kann Notizen anlegen (requireAuth reicht — requireRole analyst)', async () => {
    // Gemäß Spezifikation: requireRole('analyst') — Viewer hat keine Analyst-Rolle
    const res = await as(viewerToken).post(`${BASE}/42/notes`, { content: 'Notiz von Viewer' });
    expect(res.status).toBe(403);
  });

  test('Notiz ist nach dem Speichern per GET abrufbar', async () => {
    await as(analystToken).post(`${BASE}/55/notes`, { content: 'Persistenz-Test' });
    const res = await as(analystToken).get(`${BASE}/55/notes`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].content).toBe('Persistenz-Test');
  });
});

// ── GET /offenses/:id/notes ──────────────────────────────────────────────────

describe('GET /api/v1/qradar/offenses/:id/notes', () => {
  test('gibt leere Liste zurück wenn keine Notizen vorhanden', async () => {
    const res = await as(analystToken).get(`${BASE}/999/notes`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  test('gibt alle Notizen einer Offense zurück', async () => {
    await as(analystToken).post(`${BASE}/77/notes`, { content: 'Notiz 1' });
    await as(analystToken).post(`${BASE}/77/notes`, { content: 'Notiz 2' });
    const res = await as(analystToken).get(`${BASE}/77/notes`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  test('gibt Notizen chronologisch sortiert zurück', async () => {
    await as(analystToken).post(`${BASE}/88/notes`, { content: 'Erste' });
    await as(analystToken).post(`${BASE}/88/notes`, { content: 'Zweite' });
    const res = await as(analystToken).get(`${BASE}/88/notes`);
    expect(res.body.data[0].content).toBe('Erste');
    expect(res.body.data[1].content).toBe('Zweite');
  });

  test('gibt Notizen nur der angefragten Offense zurück', async () => {
    await as(analystToken).post(`${BASE}/11/notes`, { content: 'Für Offense 11' });
    await as(analystToken).post(`${BASE}/22/notes`, { content: 'Für Offense 22' });
    const res = await as(analystToken).get(`${BASE}/11/notes`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].content).toBe('Für Offense 11');
  });

  test('kein Token → 401', async () => {
    const res = await request(app).get(`${BASE}/42/notes`);
    expect(res.status).toBe(401);
  });

  test('Viewer kann Notizen lesen → 200', async () => {
    const res = await as(viewerToken).get(`${BASE}/42/notes`);
    expect(res.status).toBe(200);
  });

  test('Response enthält requestId', async () => {
    const res = await as(analystToken).get(`${BASE}/42/notes`);
    expect(res.body.requestId).toBeTruthy();
  });
});
