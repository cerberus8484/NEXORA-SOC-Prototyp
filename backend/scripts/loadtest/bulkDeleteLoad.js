'use strict';

// P_STABILITY_2 · 3.4 — reproduzierbarer LOKALER Lasttest (InMemory-App, KEINE DB/Infra).
// Szenario: viele Tickets seeden, dann gleichzeitig ein 100er-Bulk-Delete + parallele
// Ticket-/SOC-Metrik-/Health-Requests. Misst ECHTE Werte (keine erfundenen Zahlen):
//   HTTP-Latenz (p50/p90/p99/max), Fehlerquote, Event-Loop-Lag, Heap/RSS,
//   Queue-Stats, Health-Verhalten.
//
// Start:  node scripts/loadtest/bulkDeleteLoad.js
// Tuning: LOAD_TICKETS (Default 300) · LOAD_PARALLEL (Default 50)
//
// Hinweis: InMemory-Modus → KEIN DB-Pool. DB-Pool-Waiting/Sättigung sind nur gegen ein
// echtes Postgres aussagekräftig und gehören in den kontrollierten Pre-Deploy-Lasttest.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
// Der globale Rate-Limiter (Default 200/min) ist eine echte Schutzfunktion — für die
// reine Stabilitäts-MESSUNG auf localhost heben wir ihn an (sonst 429 beim Seeding).
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '1000000';
const request = require('supertest');

async function main() {
  const app = require('../../src/app');
  const { authService }         = require('../../src/services/AuthService');
  const { eventLoopLagMonitor } = require('../../src/metrics/eventLoopLag');
  const { integrationService }  = require('../../src/integrations/IntegrationService');
  eventLoopLagMonitor.start();

  const N        = Number(process.env.LOAD_TICKETS  || 300);
  const PARALLEL = Number(process.env.LOAD_PARALLEL || 50);
  const BULK     = 100;

  // Admin + Token
  const email = `loadtest-admin-${Date.now()}@test.soc`;
  await authService.register({ email, password: 'Load1234!', displayName: 'Load Admin', role: 'admin' });
  const token = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Load1234!' })).body.token;
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);

  // Tickets seeden
  const ids = [];
  for (let i = 0; i < N; i++) {
    const r = await auth(request(app).post('/api/v1/tickets')).send({ title: `Load ${i}`, priority: 'medium' });
    if (r.status !== 201 || !r.body.data) throw new Error(`Seed-Request ${i} fehlgeschlagen: HTTP ${r.status}`);
    ids.push(r.body.data.id);
  }

  const memBefore = process.memoryUsage();
  const t0 = Date.now();
  const latencies = [];
  let errors = 0;

  async function timed(reqPromise) {
    const s = Date.now();
    const res = await reqPromise;
    latencies.push(Date.now() - s);
    if (res.status >= 500) errors += 1;
    return res;
  }

  // Gleichzeitig: ein 100er-Bulk-Delete + parallele Lese-Last + Health.
  const ops = [];
  ops.push(timed(auth(request(app).post('/api/v1/tickets/bulk-delete')).send({ ids: ids.slice(0, BULK) })));
  for (let i = 0; i < PARALLEL; i++) {
    ops.push(timed(auth(request(app).get('/api/v1/tickets?limit=50'))));
    ops.push(timed(auth(request(app).get('/api/v1/soc-metrics'))));
    ops.push(timed(request(app).get('/api/v1/health')));
  }
  await Promise.all(ops);

  const durationMs = Date.now() - t0;
  const memAfter = process.memoryUsage();
  const qstats = await integrationService.queueStats();
  const health = await request(app).get('/api/v1/health');

  latencies.sort((a, b) => a - b);
  const pct = (q) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] : 0);

  const report = {
    config:               { tickets: N, bulkDelete: BULK, parallelClients: PARALLEL },
    requests:             latencies.length,
    errors,
    errorRate:            +(errors / Math.max(1, latencies.length)).toFixed(4),
    latencyMs:            { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: latencies[latencies.length - 1] || 0 },
    totalDurationMs:      durationMs,
    eventLoopLagSeconds:  +eventLoopLagMonitor.getLagSeconds().toFixed(4),
    heapUsedMB:           { before: +(memBefore.heapUsed / 1e6).toFixed(1), after: +(memAfter.heapUsed / 1e6).toFixed(1) },
    rssMB:                { before: +(memBefore.rss / 1e6).toFixed(1), after: +(memAfter.rss / 1e6).toFixed(1) },
    queue:                qstats,
    healthStatus:         health.body.status,
    dbPool:               'n/a (InMemory — DB-Pool-Waiting/Saettigung nur im Pre-Deploy-Lasttest gegen echtes Postgres)',
  };

  console.log(JSON.stringify(report, null, 2));
  eventLoopLagMonitor.close();
  process.exit(0);
}

main().catch((err) => { console.error('loadtest_failed', err && err.stack || err); process.exit(1); });
