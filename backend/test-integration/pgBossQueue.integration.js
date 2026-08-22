'use strict';

/**
 * P_CORR_0 — Queue-Integrationstests gegen ECHTES pg-boss v12 + ECHTES (wegwerfbares) Postgres.
 *
 * Läuft mit `node --test` (NICHT Jest): pg-boss v12 ist ESM und kann nur in normalem Node
 * via require geladen werden, nicht in der CommonJS-Jest-Runtime.
 *
 *   docker compose -f test-integration/docker-compose.queue.yml up -d
 *   npm run test:queue:integration
 *   docker compose -f test-integration/docker-compose.queue.yml down -v
 *
 * Ist kein Test-Postgres erreichbar, werden ALLE Tests sauber geskippt (kein Fehlschlag).
 * KEIN Produktiv-Postgres, KEINE echten Daten.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PgBossQueueService, DEAD_LETTER_SUFFIX } = require('../src/queue/PgBossQueueService');

// Test-DB-Verbindung (Defaults = docker-compose.queue.yml). Über ENV überschreibbar.
function applyTestEnv() {
  process.env.DB_HOST     = process.env.QUEUE_TEST_HOST || '127.0.0.1';
  process.env.DB_PORT     = process.env.QUEUE_TEST_PORT || '55432';
  process.env.DB_NAME     = process.env.QUEUE_TEST_DB   || 'queue_test';
  process.env.DB_USER     = process.env.QUEUE_TEST_USER || 'queue_test';
  process.env.DB_PASSWORD = process.env.QUEUE_TEST_PASSWORD || 'queue_test';
  process.env.DB_SSL      = 'false';
  process.env.PGBOSS_SCHEMA = 'pgboss_it';
}

let svc = null;
let startError = null;

before(async () => {
  applyTestEnv();
  try {
    svc = new PgBossQueueService();
    await svc.start();
  } catch (err) {
    startError = err;
  }
});

after(async () => {
  if (svc) await svc.stop().catch(() => {});
});

// Skippt den Test sauber, wenn kein Test-Postgres da ist.
function needsDb(t) {
  if (startError) {
    t.skip(`Test-Postgres nicht erreichbar — 'docker compose -f test-integration/docker-compose.queue.yml up -d' (${startError.message})`);
    return true;
  }
  return false;
}

async function waitFor(predicate, { timeoutMs = 20000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const q = () => `corr.it.${randomUUID().slice(0, 8)}`;

test('enqueue → Worker verarbeitet genau einmal → Completion (ack)', async (t) => {
  if (needsDb(t)) return;
  const queue = q();
  const processed = [];
  await svc.registerWorker(queue, async (job) => { processed.push(job.id); }, { pollingIntervalSeconds: 0.5 });

  const jobId = await svc.enqueue(queue, { hello: 'world' });
  const ok = await waitFor(() => processed.includes(jobId));

  assert.equal(ok, true, 'Job wurde nicht verarbeitet');
  assert.equal(processed.filter((id) => id === jobId).length, 1, 'Job mehr als einmal verarbeitet');
});

test('atomisches Claiming: konkurrierende Worker verarbeiten keinen Job doppelt', async (t) => {
  if (needsDb(t)) return;
  const queue = q();
  const counts = new Map(); // jobId → Verarbeitungs-Anzahl
  const record = async (job) => {
    counts.set(job.id, (counts.get(job.id) || 0) + 1);
    await new Promise((r) => setTimeout(r, 30)); // etwas Arbeit → Claim-Überlappung provozieren
  };
  // Zwei parallele Worker auf derselben Queue (SKIP LOCKED muss schützen).
  await svc.registerWorker(queue, record, { pollingIntervalSeconds: 0.5 });
  await svc.registerWorker(queue, record, { pollingIntervalSeconds: 0.5 });

  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(await svc.enqueue(queue, { i }));

  const ok = await waitFor(() => ids.every((id) => counts.has(id)));
  assert.equal(ok, true, 'nicht alle Jobs verarbeitet');
  for (const id of ids) assert.equal(counts.get(id), 1, `Job ${id} doppelt verarbeitet`);
});

test('retry/backoff + Dead-Letter: erschöpfte Retries landen in der DLQ', async (t) => {
  if (needsDb(t)) return;
  const queue = q();
  let attempts = 0;
  await svc.registerWorker(queue, async () => { attempts += 1; throw new Error('immer-fehler'); }, { pollingIntervalSeconds: 0.5 });

  // 2 Retries → 3 Versuche, dann Dead-Letter. Fixe kurze Delays für einen schnellen Test.
  await svc.enqueue(queue, { will: 'fail' }, { retryLimit: 2, retryDelay: 1, retryBackoff: false });

  const dlq = `${queue}${DEAD_LETTER_SUFFIX}`;
  const landed = await waitFor(async () => {
    const stats = await svc._boss.getQueueStats(dlq).catch(() => null);
    return Boolean(stats && stats.queuedCount >= 1);
  }, { timeoutMs: 30000 });

  assert.equal(landed, true, 'gescheiterter Job nicht in der Dead-Letter-Queue');
  assert.ok(attempts >= 3, `erwartete >=3 Versuche, war ${attempts}`);
});

test('Recovery: ein vor "Worker-Neustart" eingereihter Job geht nicht verloren', async (t) => {
  if (needsDb(t)) return;
  const queue = q();

  // Job einreihen, OHNE dass ein Worker läuft → bleibt persistent in der DB.
  const jobId = await svc.enqueue(queue, { survive: true });

  // "Neustart": komplett neue Service-/Boss-Instanz auf derselben DB.
  const svc2 = new PgBossQueueService();
  await svc2.start();
  try {
    const processed = [];
    await svc2.registerWorker(queue, async (job) => { processed.push(job.id); }, { pollingIntervalSeconds: 0.5 });
    const ok = await waitFor(() => processed.includes(jobId));
    assert.equal(ok, true, 'persistierter Job wurde nach Neustart nicht verarbeitet');
  } finally {
    await svc2.stop().catch(() => {});
  }
});

// Hinweis: Echte Job-Idempotenz (gleicher Input → kein Doppeljob) ist P_CORR_1a und braucht
// eine dedup-fähige Queue-Policy (stately/exclusive) + singletonKey. Der Adapter unterstützt
// beides bereits (policy/singletonKey pass-through); die Verhaltensprüfung folgt in P_CORR_1a.
