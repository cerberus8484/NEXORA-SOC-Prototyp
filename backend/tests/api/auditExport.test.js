'use strict';

// P_TRUST_1.1 · A6c — Audit-Export muss eine Kürzung SICHTBAR machen (truncated-Flag,
// kein still gekürzter forensischer Export) UND den Export selbst auditieren.
// Cap via ENV auf 3 gesetzt → Trunkierung testbar ohne 5000 Einträge.

process.env.AUDIT_EXPORT_MAX = '3';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');

let analystToken;
let viewerToken;

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();
  const a = `aexp-analyst-${Date.now()}@x.io`;
  await authService.register({ email: a, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: a, password: 'Test1234!' })).body.token;
  const v = `aexp-viewer-${Date.now()}@x.io`;
  await authService.register({ email: v, password: 'Test1234!', displayName: 'V', role: 'viewer' });
  viewerToken = (await request(app).post('/api/v1/auth/login').send({ email: v, password: 'Test1234!' })).body.token;
});

const asAnalyst = (r) => r.set('Authorization', `Bearer ${analystToken}`);

async function seedTickets(n) {
  for (let i = 0; i < n; i++) {
    await asAnalyst(request(app).post('/api/v1/tickets')).send({ title: `AExp-${Date.now()}-${i}` });
  }
}

describe('POST /api/v1/audit/export (A6c)', () => {
  it('kürzt auf den Cap und meldet truncated:true (kein stiller Verlust)', async () => {
    await seedTickets(5); // > Cap (3) → Gesamtmenge sicher größer als der Export

    const res = await asAnalyst(request(app).post('/api/v1/audit/export')).send({ format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.body.exportLimit).toBe(3);
    expect(res.body.returned).toBe(3);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.total).toBeGreaterThan(3);
    expect(res.body.truncated).toBe(true);
  });

  it('auditiert den Export mit sicheren Metadaten (Format/Anzahl/truncated/Filter)', async () => {
    await seedTickets(5);
    await asAnalyst(request(app).post('/api/v1/audit/export')).send({ format: 'pdf', action: 'TICKET_CREATE' });

    const entry = auditService.getLog().find((e) => e.action === 'AUDIT_EXPORT');
    expect(entry).toBeDefined();
    expect(entry.targetType).toBe('audit_log');
    expect(entry.metadata.format).toBe('pdf');
    expect(entry.metadata.truncated).toBe(true);
    expect(entry.metadata.exportLimit).toBe(3);
    expect(entry.metadata.filters.action).toBe('TICKET_CREATE');
    expect(entry.metadata.filters.search).toBe(false); // nur Präsenz, kein Suchbegriff/PII
  });

  it('truncated:false wenn die Gesamtmenge in den Cap passt', async () => {
    auditService.clearLog(); // leeres Log → Export liefert 0 Zeilen, keine Kürzung
    const res = await asAnalyst(request(app).post('/api/v1/audit/export')).send({ format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.returned).toBe(0);
  });

  it('search-Filter wirkt + wird als reine Präsenz auditiert (kein Begriff im Audit)', async () => {
    await seedTickets(2);
    const res = await asAnalyst(request(app).post('/api/v1/audit/export')).send({ search: 'TICKET_CREATE', format: 'csv' });

    expect(res.status).toBe(200);
    expect(res.body.data.every((e) => `${e.actorLabel} ${e.action} ${e.targetType} ${e.targetId}`.toLowerCase().includes('ticket_create'))).toBe(true);
    const entry = auditService.getLog().find((e) => e.action === 'AUDIT_EXPORT');
    expect(entry.metadata.filters.search).toBe(true);
  });

  it('ungültiges Format → 400', async () => {
    const res = await asAnalyst(request(app).post('/api/v1/audit/export')).send({ format: 'xlsx' });
    expect(res.status).toBe(400);
  });

  it('viewer → 403, ohne Auth → 401', async () => {
    const v = await request(app).post('/api/v1/audit/export').set('Authorization', `Bearer ${viewerToken}`).send({ format: 'csv' });
    expect(v.status).toBe(403);
    const none = await request(app).post('/api/v1/audit/export').send({ format: 'csv' });
    expect(none.status).toBe(401);
  });
});
