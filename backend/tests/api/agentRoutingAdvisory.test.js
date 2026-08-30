'use strict';

/**
 * Tests — ML-Routing-Advisory an Agent-Suggestion-Responses (Tag 3).
 * Beweist die Verdrahtung end-to-end über die echte Route + App-Singleton:
 *  - Default (keine Policy) → kein routing-Feld (fail-safe, unverändertes Verhalten)
 *  - Aktive Policy → advisory routing-Empfehlung (auto-accept-eligible / route-to-review)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const { authService } = require('../../src/services/AuthService');
const { agentService } = require('../../src/services/agentServiceInstance');
const { AgentSuggestion } = require('../../src/domain/AgentSuggestion');
const { SCHEMA_VERSION } = require('../../src/domain/mlRoutingPolicy');
const { _resetForTest } = require('../../src/services/routingPolicyInstance');

let token;
let tmpDir;

async function mkUser(role = 'analyst') {
  const email = `routing-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@x.io`;
  await authService.register({ email, password: 'Test1234!', displayName: role, role });
  return (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
}

async function seedSuggestion(confidence) {
  const s = new AgentSuggestion({ ticketId: 'INC-routing-test', kind: 'triage', proposal: 'Test proposal', confidence });
  await agentService._repo.save(s);
  return s.id;
}

function writeReadyPolicy(threshold = 0.7) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-policy-api-'));
  const file = path.join(tmpDir, 'recommended-routing-policy.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    status: 'ready',
    policyName: 'conservative_review_bias',
    recommendedThreshold: threshold,
  }), 'utf8');
  return file;
}

beforeAll(async () => {
  token = await mkUser('analyst');
});

afterEach(() => {
  _resetForTest();
  delete process.env.ML_ROUTING_POLICY_PATH;
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('GET /api/v1/agent/suggestions/:id — Routing-Advisory', () => {
  test('default (keine Policy) → kein routing-Feld', async () => {
    _resetForTest();
    const id = await seedSuggestion(0.8);
    const res = await request(app).get(`/api/v1/agent/suggestions/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.routing).toBeUndefined();
  });

  test('aktive Policy: hohe confidence → auto_accept_eligible', async () => {
    const id = await seedSuggestion(0.8);
    process.env.ML_ROUTING_POLICY_PATH = writeReadyPolicy(0.7);
    _resetForTest();
    const res = await request(app).get(`/api/v1/agent/suggestions/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.routing).toMatchObject({
      policyName: 'conservative_review_bias',
      threshold: 0.7,
      recommendation: 'auto_accept_eligible',
      source: 'ml-routing-policy',
    });
  });

  test('aktive Policy: niedrige confidence → route_to_review', async () => {
    const id = await seedSuggestion(0.4);
    process.env.ML_ROUTING_POLICY_PATH = writeReadyPolicy(0.7);
    _resetForTest();
    const res = await request(app).get(`/api/v1/agent/suggestions/${id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.routing.recommendation).toBe('route_to_review');
  });
});
