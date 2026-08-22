'use strict';

// Lazy Schedule-on-Read: GET /tickets/:id/evidence soll bei status 'unavailable'
// (frisch erzeugtes Ticket, nie korreliert) einen Korrelations-Job PLANEN und
// 'pending' liefern — sonst zeigt das Deck nie die reiche Engine-Evidence aus logs.
const request = require('supertest');
const app = require('../../src/app');
const { ticketService } = require('../../src/services/TicketService');
const { authService }   = require('../../src/services/AuthService');

let analystToken;
beforeAll(async () => {
  const email = `ev-sched-${Date.now()}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
});

const getEv = (id) => request(app).get(`/api/v1/tickets/${id}/evidence`).set('Authorization', `Bearer ${analystToken}`);

describe('GET /tickets/:id/evidence — Lazy Schedule-on-Read', () => {
  test('plant Korrelation bei unavailable und liefert pending (statt untätig nichts)', async () => {
    const t = await ticketService.create({ title: 'PS ScriptBlock', source: 'wazuh', priority: 'high' });
    const res = await getEv(t.id);
    expect(res.status).toBe(200);
    // Vor dem Fix: 'unavailable'. Nach dem Fix: ein Job wurde über den Read geplant.
    expect(res.body.correlation.status).toBe('pending');
  });

  test('idempotent — zweiter Read erzeugt keinen Fehler, bleibt aktiv (pending/running)', async () => {
    const t = await ticketService.create({ title: 'Idempotenz', source: 'wazuh', priority: 'medium' });
    await getEv(t.id);
    const res2 = await getEv(t.id);
    expect(res2.status).toBe(200);
    expect(['pending', 'running']).toContain(res2.body.correlation.status);
  });

  test('Scheduling-Fehler darf den Read nicht brechen (defensiv)', async () => {
    // Auch wenn das Scheduling intern scheitern würde, muss der Read 200 liefern.
    const t = await ticketService.create({ title: 'Defensiv', source: 'manual', priority: 'low' });
    const res = await getEv(t.id);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('correlation');
  });
});
