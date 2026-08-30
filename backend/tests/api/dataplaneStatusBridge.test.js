'use strict';

// End-to-End der Hub↔Backend-Status-Brücke:
//   POST /api/v1/dataplane/status (HMAC, Maschine→Backend)
//   GET  /api/v1/collectors/pipeline (Auth, Backend→UI)
//   GET  /api/v1/collectors/activity → liveProcessStatus wird live, sobald frisch.

const request = require('supertest');
const app = require('../../src/app');
const { signWebhook } = require('../../src/integrations/hmac');
const { authService } = require('../../src/services/AuthService');
const { getDataplaneStatusRepository } = require('../../src/repositories/dataplaneStatusRepositoryFactory');

const TEST_SECRET = 'dataplane-status-test-secret';

function snapshot(over = {}) {
  return {
    nodeId: 'dp-prod-1',
    reportedAt: new Date().toISOString(),
    collectors: [
      { name: 'cowrie', kind: 'siem', status: 'running', emitted: 7, error: null },
      { name: 'suricata', kind: 'ids', status: 'running', emitted: 3, error: null },
    ],
    intake: { total: 50, accepted: 48, rejected: 1, duplicate: 1, pending: 2 },
    outbox: { pending: 1, processing: 0, completed: 47, retrying: 0, failed: 0 },
    ...over,
  };
}

function signedPost(path, body, { secret = TEST_SECRET, badSig = false } = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = badSig ? 'sha256=deadbeef' : signWebhook(secret, timestamp, rawBody);
  return request(app)
    .post(path)
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', signature)
    .set('X-Webhook-Timestamp', timestamp)
    .send(body);
}

let token;

beforeEach(async () => {
  process.env.WEBHOOK_SECRET_DATAPLANE = TEST_SECRET;
  getDataplaneStatusRepository().clear();
  authService._users.clear();
  authService._blocklist.clear();
  const email = `dp-status-${Date.now()}@test.soc`;
  await authService.register({ email, password: 'Test1234!', displayName: 'U', role: 'analyst' });
  token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Test1234!' })).body.token;
});

afterEach(() => { delete process.env.WEBHOOK_SECRET_DATAPLANE; });

describe('POST /api/v1/dataplane/status (HMAC)', () => {
  test('401 ohne Signatur', async () => {
    const res = await request(app).post('/api/v1/dataplane/status').send(snapshot());
    expect(res.status).toBe(401);
  });

  test('401 bei falscher Signatur', async () => {
    const res = await signedPost('/api/v1/dataplane/status', snapshot(), { badSig: true });
    expect(res.status).toBe(401);
  });

  test('202 — gültiger Snapshot wird übernommen', async () => {
    const res = await signedPost('/api/v1/dataplane/status', snapshot());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('accepted');
    expect(res.body.nodeId).toBe('dp-prod-1');
  });

  test('400 — ungültiger Snapshot (fehlende nodeId)', async () => {
    const bad = snapshot();
    delete bad.nodeId;
    const res = await signedPost('/api/v1/dataplane/status', bad);
    expect(res.status).toBe(400);
  });

  test('400 — unzulässiger Collector-Status', async () => {
    const res = await signedPost('/api/v1/dataplane/status', snapshot({
      collectors: [{ name: 'x', status: 'on-fire' }],
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/collectors/pipeline (Auth)', () => {
  test('401 ohne Token', async () => {
    expect((await request(app).get('/api/v1/collectors/pipeline')).status).toBe(401);
  });

  test('leere Pipeline → available=false, keine Knoten', async () => {
    const res = await request(app).get('/api/v1/collectors/pipeline').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.nodes).toEqual([]);
  });

  test('nach Push: Knoten sichtbar, healthy, available=true', async () => {
    await signedPost('/api/v1/dataplane/status', snapshot());
    const res = await request(app).get('/api/v1/collectors/pipeline').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.nodes).toHaveLength(1);
    expect(res.body.data.nodes[0].nodeId).toBe('dp-prod-1');
    expect(res.body.data.nodes[0].health).toBe('healthy');
    expect(res.body.data.aggregate.collectorsRunning).toBe(2);
  });
});

describe('GET /api/v1/collectors/activity — liveProcessStatus', () => {
  test('ohne Snapshot: available=false + ehrliche Notiz', async () => {
    const res = await request(app).get('/api/v1/collectors/activity').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.liveProcessStatus.available).toBe(false);
    expect(typeof res.body.data.liveProcessStatus.note).toBe('string');
  });

  test('nach frischem Push: available=true mit frischen Knoten', async () => {
    await signedPost('/api/v1/dataplane/status', snapshot());
    const res = await request(app).get('/api/v1/collectors/activity').set('Authorization', `Bearer ${token}`);
    expect(res.body.data.liveProcessStatus.available).toBe(true);
    expect(res.body.data.liveProcessStatus.freshNodes).toBe(1);
    expect(res.body.data.liveProcessStatus.nodes[0].nodeId).toBe('dp-prod-1');
  });
});
