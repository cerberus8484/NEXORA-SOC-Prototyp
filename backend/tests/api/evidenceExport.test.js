'use strict';

// P_TRUST_1 · A4 — Evidence-Export muss auditiert sein + einen echten Custody-Zeitpunkt
// mit Actor erzeugen (kein hartkodiertes "Exported" ohne Timestamp/Actor).

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');

let token;
let email;

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();
  email = `analyst-${Date.now()}@test.soc`;
  await authService.register({ email, password: 'Test1234!', displayName: 'A', role: 'analyst' });
  token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

describe('POST /api/v1/evidence/export (P_TRUST_1 A4 / A4b)', () => {
  it('schreibt Audit + erzeugt Custody-Event mit echtem Zeitpunkt + Actor', async () => {
    const ticketId = `tkt-${Date.now()}`;
    const created = await auth(request(app).post('/api/v1/evidence')).send({ ticketId, title: 'Memory Dump' });
    expect(created.status).toBe(201);
    const evId = created.body.data.id;

    // A4b: Export ist eine bewusste POST-Aktion (kein GET-Side-Effect).
    const exp = await auth(request(app).post('/api/v1/evidence/export')).send({ ticketId });
    expect(exp.status).toBe(200);
    expect(exp.body.data.count).toBeGreaterThanOrEqual(1);
    expect(exp.body.data.exportedBy).toBe(email);

    // Audit-Eintrag: WER hat WANN WIE VIELE exportiert
    const auditEntries = auditService.getLog().filter((e) => e.action === 'evidence.export');
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].actorLabel).toBe(email);
    expect(auditEntries[0].metadata.count).toBeGreaterThanOrEqual(1);

    // Chain of Custody: echtes 'exported'-Event mit Actor + Zeitstempel (nicht null)
    const detail = await auth(request(app).get(`/api/v1/evidence/${evId}`));
    const exported = (detail.body.data.custody || []).filter((c) => c.action === 'exported');
    expect(exported.length).toBeGreaterThanOrEqual(1);
    expect(exported[0].actor).toBe(email);
    expect(typeof exported[0].createdAt).toBe('string');
  });

  it('400 ohne ticketId', async () => {
    const res = await auth(request(app).post('/api/v1/evidence/export')).send({});
    expect(res.status).toBe(400);
  });
});
