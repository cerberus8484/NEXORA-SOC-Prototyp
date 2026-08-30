'use strict';

// Container-Entrypoint des Outbox-Workers (Korrelierungs-Engine-Runtime).
// Pool → Postgres-Outbox-Store → HMAC-Incident-Emitter → Worker-Loop + Health.
// Schließt die Pipeline: Outbox(pending) → Fusion → Nexora-Ingress.
//
// ENV: DATAPLANE_DB_URL · INGRESS_URL · INGRESS_SECRET · WORKER_ID
//      POLL_INTERVAL_MS (default 3000) · HEALTH_PORT · FUSION_WINDOW_MS · MAX_ATTEMPTS · BACKOFF_MS
const http = require('node:http');
const { Pool } = require('pg');
const { createPostgresOutboxStore } = require('./postgresOutboxStore');
const { createIncidentEmitter } = require('./incidentEmitter');
const { createOutboxWorker } = require('./outboxWorker');

function log(o) { process.stderr.write(JSON.stringify({ svc: 'outbox-worker', ...o }) + '\n'); }

function startHealth(port, counters) {
  if (!port) return;
  http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'ok', service: 'outbox-worker', counters })); return; }
    res.writeHead(404).end();
  }).listen(port, () => log({ msg: 'health server listening', port }));
}

async function main() {
  const dbUrl = process.env.DATAPLANE_DB_URL;
  if (!dbUrl) throw new Error('DATAPLANE_DB_URL erforderlich');
  if (!process.env.INGRESS_URL || !process.env.INGRESS_SECRET) throw new Error('INGRESS_URL + INGRESS_SECRET erforderlich');

  const pool = new Pool({ connectionString: dbUrl });
  const store = createPostgresOutboxStore(pool);
  const emit = createIncidentEmitter({ url: process.env.INGRESS_URL, secret: process.env.INGRESS_SECRET });
  const counters = { runs: 0, incidents: 0, completed: 0, retried: 0, failed: 0 };
  const worker = createOutboxWorker({
    store, emit,
    workerId: process.env.WORKER_ID || 'outbox-worker-1',
    maxAttempts: Number(process.env.MAX_ATTEMPTS || 5) || 5,
    backoffMs: Number(process.env.BACKOFF_MS || 5000) || 5000,
    windowMs: Number(process.env.FUSION_WINDOW_MS || 0) || undefined,
    onError: (info) => log({ msg: 'emit error', ...info }),
  });

  startHealth(Number(process.env.HEALTH_PORT || 0) || 0, counters);
  const interval = Number(process.env.POLL_INTERVAL_MS || 3000) || 3000;
  log({ msg: 'started', interval, ingress: process.env.INGRESS_URL });

  let stopping = false;
  const tick = async () => {
    if (stopping) return;
    try {
      const s = await worker.runOnce();
      counters.runs += 1;
      counters.incidents += s.incidents; counters.completed += s.completed;
      counters.retried += s.retried; counters.failed += s.failed;
      if (s.claimed > 0) log({ msg: 'batch', ...s });
    } catch (err) {
      log({ msg: 'run error', error: err.message });
    } finally {
      if (!stopping) setTimeout(tick, interval);
    }
  };
  tick();

  const shutdown = async () => { stopping = true; log({ msg: 'shutdown' }); await pool.end().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { log({ msg: 'fatal', error: err.message }); process.exit(1); });
