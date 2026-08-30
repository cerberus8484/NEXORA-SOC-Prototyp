'use strict';

/**
 * Tests — GET /api/v1/agent/guardrails (alle Rollen) + GET /api/v1/agent/metrics (engineer+admin).
 * Read-only Transparenz-Endpoints (Welle 2 der KI-Settings-Seite).
 */

const request = require('supertest');
const app     = require('../../src/app');
const { authService } = require('../../src/services/AuthService');

let adminToken, engineerToken, analystToken, viewerToken;

async function mkUser(role) {
  const email = `agm-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}

const as = (t) => ({ get: (u) => request(app).get(u).set('Authorization', `Bearer ${t}`) });

beforeAll(async () => {
  adminToken    = await mkUser('admin');
  engineerToken = await mkUser('engineer');
  analystToken  = await mkUser('analyst');
  viewerToken   = await mkUser('viewer');
});

describe('GET /api/v1/agent/guardrails — Auth + Shape', () => {
  it('ohne Auth → 401', async () => {
    expect((await request(app).get('/api/v1/agent/guardrails')).status).toBe(401);
  });

  it('viewer (alle Rollen erlaubt) → 200 mit echten Floor-Werten', async () => {
    const res = await as(viewerToken).get('/api/v1/agent/guardrails');
    expect(res.status).toBe(200);
    const g = res.body.data;
    expect(g.evidenceFloor).toEqual({
      enabled: true, confirmedVtMin: 5, suspiciousVtMin: 1,
      confirmedConfidenceFloor: 0.9, suspiciousConfidenceFloor: 0.7,
    });
    expect(g.benignFloor).toEqual({ enabled: true, confidenceFloor: 0.8 });
    expect(g.antiHallucination).toEqual({ enabled: true });
    expect(g.humanInTheLoop.allSuggestionsRequireApproval).toBe(true);
    expect(typeof g.humanInTheLoop.autonomyEnabled).toBe('boolean');
  });

  it('analyst → 200 (kein RBAC-Block)', async () => {
    expect((await as(analystToken).get('/api/v1/agent/guardrails')).status).toBe(200);
  });
});

describe('GET /api/v1/agent/metrics — RBAC + Shape', () => {
  it('ohne Auth → 401', async () => {
    expect((await request(app).get('/api/v1/agent/metrics')).status).toBe(401);
  });

  it('viewer → 403', async () => {
    expect((await as(viewerToken).get('/api/v1/agent/metrics')).status).toBe(403);
  });

  it('analyst → 403', async () => {
    expect((await as(analystToken).get('/api/v1/agent/metrics')).status).toBe(403);
  });

  it('engineer → 200 mit Totals + byProvider', async () => {
    const res = await as(engineerToken).get('/api/v1/agent/metrics');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(typeof d.sinceBoot).toBe('string');
    expect(d.estimated).toBe(true);
    expect(d.totals).toHaveProperty('calls');
    expect(d.totals).toHaveProperty('avgLatencyMs');
    expect(d.totals).toHaveProperty('estPromptTokens');
    expect(d.totals).toHaveProperty('estCostUsd');
    expect(Array.isArray(d.byProvider)).toBe(true);
  });

  it('admin → 200', async () => {
    expect((await as(adminToken).get('/api/v1/agent/metrics')).status).toBe(200);
  });
});
