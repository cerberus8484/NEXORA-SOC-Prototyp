'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.AUTH_RETURN_TOKEN_JSON = process.env.AUTH_RETURN_TOKEN_JSON || 'true';
process.env.DB_ENABLED = process.env.DB_ENABLED || 'true';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '55432';
process.env.DB_NAME = process.env.DB_NAME || 'soc_proof';
process.env.DB_USER = process.env.DB_USER || 'soc_api';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'devpassword';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'proof-jwt-secret';
process.env.DB_POOL_MAX = process.env.DB_POOL_MAX || '2';
process.env.DB_CONNECTION_TIMEOUT_MS = process.env.DB_CONNECTION_TIMEOUT_MS || '4000';
process.env.DB_STATEMENT_TIMEOUT_MS = process.env.DB_STATEMENT_TIMEOUT_MS || '750';
process.env.DB_QUERY_TIMEOUT_MS = process.env.DB_QUERY_TIMEOUT_MS || '1000';
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '1000000';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const request = require('supertest');
const { migrate, pool } = require('../../src/db/pool');
const { healthPool } = require('../../src/db/healthPool');
const { authService } = require('../../src/services/AuthService');
const app = require('../../src/app');
const { registry } = require('../../src/metrics/metricsRegistry');
const { registerPoolMetrics } = require('../../src/metrics/poolMetrics');
const { poolSnapshot } = require('../../src/db/poolStats');
const { eventLoopLagMonitor } = require('../../src/metrics/eventLoopLag');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function metricValue(text, name, labels = {}) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith(name)) continue;
    if (line.startsWith(`${name}{`)) {
      const labelText = line.slice(name.length + 1, line.indexOf('}'));
      const ok = Object.entries(labels).every(([key, value]) => labelText.includes(`${key}="${value}"`));
      if (!ok) continue;
      return Number(line.slice(line.indexOf('}') + 1).trim());
    }
    if (Object.keys(labels).length === 0) {
      const parts = line.trim().split(/\s+/);
      return Number(parts[parts.length - 1]);
    }
  }
  return null;
}

async function scrapeMetrics() {
  const res = await request(app).get('/metrics');
  return {
    status: res.status,
    text: res.text,
    waiting: metricValue(res.text, 'soc_db_pool_connections', { pool: 'api', state: 'waiting' }),
    apiTotal: metricValue(res.text, 'soc_db_pool_connections', { pool: 'api', state: 'total' }),
    apiIdle: metricValue(res.text, 'soc_db_pool_connections', { pool: 'api', state: 'idle' }),
    healthTotal: metricValue(res.text, 'soc_db_pool_connections', { pool: 'health', state: 'total' }),
    saturationWarnings: metricValue(res.text, 'soc_db_pool_saturation_warnings_total'),
    queryTimeouts: metricValue(res.text, 'soc_db_query_timeouts_total'),
    inFlight: metricValue(res.text, 'soc_http_requests_in_flight'),
  };
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

async function timed(call) {
  const start = Date.now();
  const res = await call;
  return { status: res.status, durationMs: Date.now() - start, body: res.body };
}

async function main() {
  eventLoopLagMonitor.start();
  registerPoolMetrics(registry, {
    apiSnapshot: () => poolSnapshot(pool),
    healthSnapshot: () => poolSnapshot(healthPool),
  });

  await migrate();

  const email = `proof-admin-${Date.now()}@nexora.test`;
  const password = 'Proof1234!';
  await authService.register({ email, password, displayName: 'Proof Admin', role: 'admin' });
  const login = await request(app).post('/api/v1/auth/login').send({ email, password });
  const token = login.body && login.body.token;
  if (!token) throw new Error('Login lieferte kein Bearer-Token. AUTH_RETURN_TOKEN_JSON=true pruefen.');
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);

  const tickets = [];
  const seedCount = Number(process.env.PROOF_SEED_TICKETS || '250');
  for (let i = 0; i < seedCount; i += 1) {
    const res = await auth(request(app).post('/api/v1/tickets')).send({
      title: `Proof Ticket ${i}`,
      priority: 'medium',
      source: 'manual',
      description: 'postgres proof seed',
    });
    if (res.status !== 201) throw new Error(`Ticket-Seed fehlgeschlagen: HTTP ${res.status}`);
    tickets.push(res.body.data.id);
  }

  const baselineMetrics = await scrapeMetrics();
  const baselineHealth = await request(app).get('/api/v1/health');

  const holdMs = Number(process.env.PROOF_POOL_HOLD_MS || '1500');
  const blockers = [];
  const max = Number(process.env.DB_POOL_MAX || '2');
  for (let i = 0; i < max; i += 1) blockers.push(await pool.connect());

  const ticketOps = [];
  for (let i = 0; i < 10; i += 1) ticketOps.push(timed(auth(request(app).get('/api/v1/tickets?limit=50'))));
  const healthOps = [];
  for (let i = 0; i < 5; i += 1) healthOps.push(timed(request(app).get('/api/v1/health')));

  await sleep(250);
  const blockedMetrics = await scrapeMetrics();
  await sleep(holdMs);
  blockers.forEach((client) => client.release());

  const ticketResults = await Promise.all(ticketOps);
  const healthResults = await Promise.all(healthOps);
  const afterSaturationMetrics = await scrapeMetrics();

  const lockClient = await pool.connect();
  const timeoutBefore = afterSaturationMetrics.queryTimeouts || 0;
  let timeoutResponse;
  try {
    await lockClient.query('BEGIN');
    await lockClient.query('SELECT id FROM tickets WHERE id = $1 FOR UPDATE', [tickets[0]]);
    timeoutResponse = await timed(
      auth(request(app).put(`/api/v1/tickets/${tickets[0]}`)).send({ title: 'Locked update should timeout' }),
    );
  } finally {
    try { await lockClient.query('ROLLBACK'); } catch {}
    lockClient.release();
  }
  const afterTimeoutMetrics = await scrapeMetrics();

  const report = {
    db: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      poolMax: Number(process.env.DB_POOL_MAX),
      statementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS),
      queryTimeoutMs: Number(process.env.DB_QUERY_TIMEOUT_MS),
      connectionTimeoutMs: Number(process.env.DB_CONNECTION_TIMEOUT_MS),
    },
    baseline: {
      health: baselineHealth.body,
      metrics: baselineMetrics,
      poolSnapshot: poolSnapshot(pool),
      healthPoolSnapshot: poolSnapshot(healthPool),
    },
    saturationProof: {
      holdMs,
      blockedMetrics,
      afterMetrics: afterSaturationMetrics,
      saturationWarningsDelta: (afterSaturationMetrics.saturationWarnings || 0) - (baselineMetrics.saturationWarnings || 0),
      maxObservedWaiting: Math.max(blockedMetrics.waiting || 0, afterSaturationMetrics.waiting || 0),
      ticketRequests: {
        count: ticketResults.length,
        statuses: [...new Set(ticketResults.map((r) => r.status))],
        p50Ms: percentile(ticketResults.map((r) => r.durationMs), 0.5),
        p90Ms: percentile(ticketResults.map((r) => r.durationMs), 0.9),
        maxMs: Math.max(...ticketResults.map((r) => r.durationMs)),
      },
      healthRequests: {
        count: healthResults.length,
        statuses: [...new Set(healthResults.map((r) => r.status))],
        dbStates: [...new Set(healthResults.map((r) => r.body && r.body.db))],
        appStates: [...new Set(healthResults.map((r) => r.body && r.body.status))],
      },
    },
    timeoutProof: {
      responseStatus: timeoutResponse.status,
      responseBody: timeoutResponse.body,
      durationMs: timeoutResponse.durationMs,
      queryTimeoutsBefore: timeoutBefore,
      queryTimeoutsAfter: afterTimeoutMetrics.queryTimeouts || 0,
      queryTimeoutsDelta: (afterTimeoutMetrics.queryTimeouts || 0) - timeoutBefore,
    },
    finalPoolSnapshot: poolSnapshot(pool),
    finalHealthPoolSnapshot: poolSnapshot(healthPool),
    eventLoopLagSeconds: Number(eventLoopLagMonitor.getLagSeconds().toFixed(4)),
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    eventLoopLagMonitor.close();
    await Promise.allSettled([pool.end(), healthPool.end()]);
  });
