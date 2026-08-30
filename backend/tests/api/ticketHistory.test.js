'use strict';

const request = require('supertest');
const app     = require('../../src/app');
const { ticketService } = require('../../src/services/TicketService');
const { authService }   = require('../../src/services/AuthService');
const { auditService }  = require('../../src/services/AuditService');

let analystToken;

beforeEach(async () => {
  ticketService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();

  const email = `history-${Date.now()}@test.soc`;
  await authService.register({ email, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
  analystToken = res.body.token;
});

const auth = {
  get:  (url) => request(app).get(url).set('Authorization',  `Bearer ${analystToken}`),
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${analystToken}`),
  put:  (url) => request(app).put(url).set('Authorization',  `Bearer ${analystToken}`),
};

describe('AuditService.findRecent — targetId-Filter', () => {
  test('filtert In-Memory-Einträge nach targetId', async () => {
    await auditService.write({ action: 'TICKET_CREATE', targetType: 'ticket', targetId: 't-1' });
    await auditService.write({ action: 'TICKET_UPDATE', targetType: 'ticket', targetId: 't-2' });
    await auditService.write({ action: 'TICKET_UPDATE', targetType: 'ticket', targetId: 't-1' });

    const result = await auditService.findRecent({ targetId: 't-1' });
    // findRecent gibt { data, total, limit, offset } zurück — kein nacktes Array mehr
    expect(result.data).toHaveLength(2);
    expect(result.data.every((e) => e.targetId === 't-1')).toBe(true);
  });
});

describe('GET /api/v1/tickets/:id/history', () => {
  test('liefert Audit-Historie des Tickets (Create + Update, neueste zuerst)', async () => {
    const created = await auth.post('/api/v1/tickets').send({ title: 'History-Ticket' });
    const id = created.body.data.id;
    await auth.put(`/api/v1/tickets/${id}`).send({ status: 'in_progress', analyst: 'Toto' });

    const res = await auth.get(`/api/v1/tickets/${id}/history`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].action).toBe('TICKET_UPDATE');
    expect(res.body.data[1].action).toBe('TICKET_CREATE');
    expect(res.body.data[0]).toHaveProperty('actorLabel');
    expect(res.body.data[0]).toHaveProperty('createdAt');
  });

  test('Update-Eintrag enthält die geänderten Feldnamen (metadata.fields)', async () => {
    const created = await auth.post('/api/v1/tickets').send({ title: 'Felder-Ticket' });
    const id = created.body.data.id;
    await auth.put(`/api/v1/tickets/${id}`).send({ decision: 'benign', confidence: 90 });

    const res = await auth.get(`/api/v1/tickets/${id}/history`);
    const update = res.body.data.find((e) => e.action === 'TICKET_UPDATE');
    // Exakt die gesendeten Felder — keine von Joi aufgefüllten Defaults
    expect(update.metadata.fields).toEqual(['decision', 'confidence']);
  });

  test('fremde Ticket-IDs erscheinen nicht in der Historie', async () => {
    const a = await auth.post('/api/v1/tickets').send({ title: 'Ticket A' });
    const b = await auth.post('/api/v1/tickets').send({ title: 'Ticket B' });
    await auth.put(`/api/v1/tickets/${b.body.data.id}`).send({ status: 'in_progress' });

    const res = await auth.get(`/api/v1/tickets/${a.body.data.id}/history`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].action).toBe('TICKET_CREATE');
  });

  test('unbekanntes Ticket → 404', async () => {
    const res = await auth.get('/api/v1/tickets/00000000-0000-0000-0000-000000000000/history');
    expect(res.status).toBe(404);
  });

  test('ohne Auth → 401', async () => {
    const res = await request(app).get('/api/v1/tickets/x/history');
    expect(res.status).toBe(401);
  });
});
