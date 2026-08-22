'use strict';

// P_STABILITY_1 · Task 2 (Block 2a) — echter Bulk-Delete-Endpunkt.
// Ziel: EIN admin-geschützter Request statt N Einzel-Deletes, transaktional,
// nachvollziehbares Ergebnis (requested/deleted/missing), EIN Sammel-Audit-Eintrag,
// strikte RBAC + Maximalgröße, idempotent, keine stillen Fehler.

const request = require('supertest');
const app     = require('../../src/app');
const { ticketService } = require('../../src/services/TicketService');
const { authService }   = require('../../src/services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../../src/services/AuditService');

let analystToken;
let adminToken;

beforeEach(async () => {
  ticketService._repo.clear();
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();

  const aEmail = `analyst-${Date.now()}@test.soc`;
  await authService.register({ email: aEmail, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: aEmail, password: 'Test1234!' })).body.token;

  const dEmail = `admin-${Date.now()}@test.soc`;
  await authService.register({ email: dEmail, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email: dEmail, password: 'Test1234!' })).body.token;
});

const asAnalyst = {
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${analystToken}`),
  get:  (url) => request(app).get(url).set('Authorization', `Bearer ${analystToken}`),
};
const asAdmin = {
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${adminToken}`),
  get:  (url) => request(app).get(url).set('Authorization', `Bearer ${adminToken}`),
};

// Mehrere Tickets anlegen, IDs zurückgeben.
async function seedTickets(n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = await asAnalyst.post('/api/v1/tickets').send({ title: `Bulk-Ticket ${i}` });
    ids.push(r.body.data.id);
  }
  return ids;
}

const BOGUS_UUID = '00000000-0000-4000-8000-000000000000';

describe('POST /api/v1/tickets/bulk-delete', () => {
  it('admin löscht mehrere Tickets in EINEM Request → 200, Tickets weg', async () => {
    const ids = await seedTickets(3);
    const res = await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids });

    expect(res.status).toBe(200);
    expect(res.body.data.requested).toBe(3);
    expect(res.body.data.deleted).toBe(3);
    expect(res.body.data.missing).toBe(0);

    for (const id of ids) {
      const get = await asAnalyst.get(`/api/v1/tickets/${id}`);
      expect(get.status).toBe(404);
    }
  });

  it('nicht-admin (analyst) → 403, nichts gelöscht', async () => {
    const ids = await seedTickets(2);
    const res = await asAnalyst.post('/api/v1/tickets/bulk-delete').send({ ids });
    expect(res.status).toBe(403);

    // Tickets müssen noch existieren
    for (const id of ids) {
      const get = await asAnalyst.get(`/api/v1/tickets/${id}`);
      expect(get.status).toBe(200);
    }
  });

  it('Teilmenge: existierende + unbekannte ID → deleted/missing korrekt, kein Crash', async () => {
    const ids = await seedTickets(2);
    const res = await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids: [...ids, BOGUS_UUID] });

    expect(res.status).toBe(200);
    expect(res.body.data.requested).toBe(3);
    expect(res.body.data.deleted).toBe(2);
    expect(res.body.data.missing).toBe(1);
  });

  it('schreibt GENAU EINEN Sammel-Audit-Eintrag (nicht N)', async () => {
    const ids = await seedTickets(3);
    await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids });

    const bulkEntries = auditService.getLog().filter((e) => e.action === AUDIT_ACTIONS.TICKET_BULK_DELETE);
    expect(bulkEntries).toHaveLength(1);
    expect(bulkEntries[0].metadata.requested).toBe(3);
    expect(bulkEntries[0].metadata.deleted).toBe(3);
    // Kein einzelner TICKET_DELETE-Spam
    expect(auditService.getLog().filter((e) => e.action === AUDIT_ACTIONS.TICKET_DELETE)).toHaveLength(0);
  });

  it('dedupliziert doppelte IDs im Payload', async () => {
    const [id] = await seedTickets(1);
    const res = await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids: [id, id] });
    expect(res.status).toBe(200);
    expect(res.body.data.requested).toBe(1);
    expect(res.body.data.deleted).toBe(1);
  });

  it('idempotent: zweiter Aufruf mit denselben IDs → deleted:0, missing:N, kein Fehler', async () => {
    const ids = await seedTickets(2);
    await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids });
    const second = await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids });
    expect(second.status).toBe(200);
    expect(second.body.data.deleted).toBe(0);
    expect(second.body.data.missing).toBe(2);
  });

  it('leeres ids-Array → 400', async () => {
    const res = await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('mehr als das Maximum (101 IDs) → 400 (keine unbounded Operation)', async () => {
    const many = Array.from({ length: 101 }, () => BOGUS_UUID.replace(/0$/, '1'));
    const res = await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids: many });
    expect(res.status).toBe(400);
  });

  it('nicht-UUID-ID → 400 (Input-Validierung, schützt Postgres-Cast)', async () => {
    const res = await asAdmin.post('/api/v1/tickets/bulk-delete').send({ ids: ['not-a-uuid'] });
    expect(res.status).toBe(400);
  });

  it('fehlendes ids-Feld → 400', async () => {
    const res = await asAdmin.post('/api/v1/tickets/bulk-delete').send({});
    expect(res.status).toBe(400);
  });
});
