'use strict';

const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { auditService } = require('../../src/services/AuditService');
const { AgentSuggestion } = require('../../src/domain/AgentSuggestion');
const { Ticket } = require('../../src/domain/Ticket');
const { mlEvalExportService } = require('../../src/services/mlEvalExportInstance');

let adminToken;
let analystToken;

beforeEach(async () => {
  authService._users.clear();
  authService._blocklist.clear();
  auditService.clearLog();
  mlEvalExportService._agentSuggestionRepo._items?.clear();
  mlEvalExportService._ticketRepo.clear?.();

  const suffix = `${Date.now()}-${Math.random()}`;
  await authService.register({ email: `ml-admin-${suffix}@x.io`, password: 'Test1234!', displayName: 'Admin', role: 'admin' });
  adminToken = (await request(app).post('/api/v1/auth/login').send({ email: `ml-admin-${suffix}@x.io`, password: 'Test1234!' })).body.token;
  await authService.register({ email: `ml-analyst-${suffix}@x.io`, password: 'Test1234!', displayName: 'Analyst', role: 'analyst' });
  analystToken = (await request(app).post('/api/v1/auth/login').send({ email: `ml-analyst-${suffix}@x.io`, password: 'Test1234!' })).body.token;
});

const asAdmin = (r) => r.set('Authorization', `Bearer ${adminToken}`);

describe('POST /api/v1/ml/eval/export', () => {
  test('admin bekommt JSONL-Snapshot ohne Freitext-Rohdaten und Export wird auditiert', async () => {
    await mlEvalExportService._agentSuggestionRepo.save(new AgentSuggestion({
      id: 'sg-api-1',
      ticketId: 't-api-1',
      proposal: 'Do not export this proposal',
      rationale: 'Do not export this rationale',
      verdict: 'suspicious',
      confidence: 0.73,
      status: 'approved',
      model: 'stub:test',
      reviewedAt: '2026-06-29T10:00:00Z',
    }));
    await mlEvalExportService._ticketRepo.save(new Ticket({
      id: 't-api-2',
      state: 'CLOSED',
      closeReason: 'resolved',
      decision: 'incident',
      confidence: 91,
      title: 'Do not export this title',
      updatedAt: '2026-06-29T11:00:00Z',
    }));

    const res = await asAdmin(request(app).post('/api/v1/ml/eval/export'))
      .send({ format: 'jsonl', include: 'all', limit: 20 });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(res.headers['x-nexora-ml-eval-schema']).toBe('v1');
    expect(res.headers['x-nexora-ml-eval-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(res.headers['x-nexora-ml-eval-generated-at']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const records = res.text.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(res.text).not.toContain('Do not export');

    const auditEntry = auditService.getLog().find((entry) => entry.action === 'ML_EVAL_EXPORT');
    expect(auditEntry).toBeDefined();
    expect(auditEntry.metadata).toMatchObject({ format: 'jsonl', include: 'all', returned: 2 });
    expect(auditEntry.metadata.recordSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('json-Format liefert Metadaten fuer Preview', async () => {
    await mlEvalExportService._agentSuggestionRepo.save(new AgentSuggestion({
      id: 'sg-json-api',
      ticketId: 't-json-api',
      proposal: 'ok',
      status: 'rejected',
      reviewedAt: '2026-06-29T10:00:00Z',
    }));

    const res = await asAdmin(request(app).post('/api/v1/ml/eval/export'))
      .send({ format: 'json', include: 'agent_suggestions', limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({
      schemaVersion: 'v1',
      returned: 1,
      include: 'agent_suggestions',
    });
    expect(res.body.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body.meta.recordSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.meta.labelSourceCounts).toEqual({ agent_review: 1 });
    expect(res.body.meta.humanLabelCounts).toEqual({ rejected: 1 });
    expect(res.body.data[0]).toMatchObject({ entity_type: 'agent_suggestion', entity_id: 'sg-json-api' });
  });

  test('analyst und unauthenticated werden abgewiesen, invalid format ist 400', async () => {
    const analyst = await request(app)
      .post('/api/v1/ml/eval/export')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ format: 'jsonl' });
    expect(analyst.status).toBe(403);

    const none = await request(app).post('/api/v1/ml/eval/export').send({ format: 'jsonl' });
    expect(none.status).toBe(401);

    const invalid = await asAdmin(request(app).post('/api/v1/ml/eval/export')).send({ format: 'xlsx' });
    expect(invalid.status).toBe(400);
  });
});
