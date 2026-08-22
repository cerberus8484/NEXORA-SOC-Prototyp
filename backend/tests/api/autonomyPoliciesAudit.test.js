'use strict';

// P_TRUST_1 · A5 — sicherheitskritische Autonomy-Policy-Änderungen (Create/Update/Delete)
// müssen auditiert sein (vorher: keine Audit-Einträge).

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');

let adminToken;
const baseBody = {
  customer: '*', actionClass: 'enrichment', mode: 'advisory', minVerdict: 'confirmed_incident',
  minConfidence: 0.9, requireEvidenceFloor: true, maxPerHour: 0, enabled: false,
};

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();
  const email = `admin-${Date.now()}@test.soc`;
  await authService.register({ email, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
});

const auth = (r) => r.set('Authorization', `Bearer ${adminToken}`);

describe('Autonomy-Policy CRUD-Audit (P_TRUST_1 A5)', () => {
  it('Create/Update/Delete schreiben je einen Audit-Eintrag', async () => {
    const body = { ...baseBody, customer: `audit-${Date.now()}` };
    const created = (await auth(request(app).post('/api/v1/autonomy-policies')).send(body)).body.data;
    expect(created.id).toBeDefined();

    await auth(request(app).put(`/api/v1/autonomy-policies/${created.id}`)).send({ mode: 'assisted' });
    await auth(request(app).delete(`/api/v1/autonomy-policies/${created.id}`));

    const actions = auditService.getLog().map((e) => e.action);
    expect(actions).toContain('AUTONOMY_POLICY_CREATED');
    expect(actions).toContain('AUTONOMY_POLICY_UPDATED');
    expect(actions).toContain('AUTONOMY_POLICY_DELETED');

    const del = auditService.getLog().find((e) => e.action === 'AUTONOMY_POLICY_DELETED');
    expect(del.targetId).toBe(created.id);
    expect(del.targetType).toBe('autonomy_policy');

    const createdEntry = auditService.getLog().find((e) => e.action === 'AUTONOMY_POLICY_CREATED');
    expect(createdEntry.metadata.actionClass).toBe('enrichment'); // nur sichere Metadaten
  });
});
