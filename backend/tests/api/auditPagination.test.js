'use strict';

// TDD RED: API-Tests für GET /api/v1/audit mit offset+total-Envelope.
// Prüft: Antwort-Format, offset wirkt, ungültige Query → 400, RBAC.

const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let analystToken;
let viewerToken;

beforeAll(async () => {
  const ts = Date.now();

  const analystEmail = `audit-page-analyst-${ts}@x.io`;
  await authService.register({ email: analystEmail, password: 'Test1234!', displayName: 'AnalystPager', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: analystEmail, password: 'Test1234!' })).body.token;

  const viewerEmail = `audit-page-viewer-${ts}@x.io`;
  await authService.register({ email: viewerEmail, password: 'Test1234!', displayName: 'ViewerPager', role: 'viewer' });
  viewerToken = (await request(app).post('/api/v1/auth/login').send({ email: viewerEmail, password: 'Test1234!' })).body.token;
});

describe('GET /api/v1/audit — Pagination Envelope', () => {
  test('Antwort enthält { data, total, limit, offset, requestId }', async () => {
    // Eintrag erzeugen damit data nicht leer ist
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${analystToken}`).send({ title: 'AuditPage-Test' });

    const res = await request(app)
      .get('/api/v1/audit?limit=10&offset=0')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.limit).toBe('number');
    expect(typeof res.body.offset).toBe('number');
    expect(res.body).toHaveProperty('requestId');
  });

  test('limit im Response entspricht dem angeforderten Wert (cap 200)', async () => {
    const res = await request(app)
      .get('/api/v1/audit?limit=5')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  test('offset=0 und offset=1 liefern verschiedene erste Einträge', async () => {
    // Mind. 2 Einträge erzeugen
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${analystToken}`).send({ title: 'AuditOffset-A' });
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${analystToken}`).send({ title: 'AuditOffset-B' });

    const page0 = await request(app)
      .get('/api/v1/audit?limit=1&offset=0')
      .set('Authorization', `Bearer ${analystToken}`);
    const page1 = await request(app)
      .get('/api/v1/audit?limit=1&offset=1')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(page0.status).toBe(200);
    expect(page1.status).toBe(200);
    expect(page0.body.offset).toBe(0);
    expect(page1.body.offset).toBe(1);

    // Wenn genug Einträge da sind, unterscheiden sie sich
    if (page0.body.data.length > 0 && page1.body.data.length > 0) {
      expect(page0.body.data[0].id).not.toBe(page1.body.data[0].id);
    }
  });

  test('total ist >= data.length (nie mehr Elemente als Gesamtmenge)', async () => {
    const res = await request(app)
      .get('/api/v1/audit?limit=2&offset=0')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(res.body.data.length);
  });

  test('action-Filter kombiniert mit offset → 200', async () => {
    const res = await request(app)
      .get('/api/v1/audit?action=TICKET_CREATE&limit=5&offset=0')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.every((e) => e.action === 'TICKET_CREATE')).toBe(true);
  });

  test('ungültiger limit-Wert (string "abc") → 400', async () => {
    const res = await request(app)
      .get('/api/v1/audit?limit=abc')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(400);
  });

  test('limit=0 → 400 (Minimum ist 1)', async () => {
    const res = await request(app)
      .get('/api/v1/audit?limit=0')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(400);
  });

  test('limit=201 → 400 (Maximum ist 200)', async () => {
    const res = await request(app)
      .get('/api/v1/audit?limit=201')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(400);
  });

  test('offset negativ → 400', async () => {
    const res = await request(app)
      .get('/api/v1/audit?offset=-1')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(400);
  });

  test('viewer → 403 (RBAC: audit nur für analyst+)', async () => {
    const res = await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(403);
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/audit');
    expect(res.status).toBe(401);
  });
});

// A6a — serverseitige Suche + explizite Pagination-Metadaten.
describe('GET /api/v1/audit — Suche + Pagination-Metadaten (A6a)', () => {
  test('Response enthält page, pageSize, hasNext, hasPrevious', async () => {
    const res = await request(app)
      .get('/api/v1/audit?limit=5&offset=0')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(5);
    expect(res.body.page).toBe(1);
    expect(typeof res.body.hasNext).toBe('boolean');
    expect(res.body.hasPrevious).toBe(false);
  });

  test('offset>0 → hasPrevious true, page korrekt berechnet', async () => {
    const res = await request(app)
      .get('/api/v1/audit?limit=2&offset=2')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);          // floor(2/2)+1
    expect(res.body.hasPrevious).toBe(true);
  });

  test('search filtert SERVERSEITIG: nicht vorhandener Begriff → total 0 (nicht nur Seiten-Filter)', async () => {
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${analystToken}`).send({ title: 'AuditSearch-1' });
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${analystToken}`).send({ title: 'AuditSearch-2' });

    const none = await request(app)
      .get('/api/v1/audit?search=zzz-definitiv-nicht-vorhanden-xyz')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(none.status).toBe(200);
    expect(none.body.total).toBe(0);        // Server hat gefiltert — kein Client-Only-Filter
    expect(none.body.data).toHaveLength(0);
  });

  test('search über die GESAMTE Menge + Pagination: total zählt alle Treffer, data nur eine Seite', async () => {
    const hit = await request(app)
      .get('/api/v1/audit?search=TICKET_CREATE&limit=1&offset=0')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(hit.status).toBe(200);
    expect(hit.body.total).toBeGreaterThanOrEqual(1);
    expect(hit.body.data.length).toBeLessThanOrEqual(1);
    expect(hit.body.data.every((e) =>
      `${e.actorLabel} ${e.action} ${e.targetType} ${e.targetId}`.toLowerCase().includes('ticket_create'),
    )).toBe(true);
  });

  test('search kombiniert mit action-Filter → 200, beide greifen', async () => {
    const res = await request(app)
      .get('/api/v1/audit?action=TICKET_CREATE&search=ticket&limit=5')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => e.action === 'TICKET_CREATE')).toBe(true);
  });

  test('search > 200 Zeichen → 400 (gedeckelt, keine unbounded Query)', async () => {
    const res = await request(app)
      .get(`/api/v1/audit?search=${'a'.repeat(201)}`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(400);
  });
});
