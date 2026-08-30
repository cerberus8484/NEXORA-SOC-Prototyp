'use strict';

// Integrationstest gegen ein echtes Postgres (Lab). Ohne DATAPLANE_TEST_DB_URL → übersprungen.
// Start des Lab-Postgres:  docker compose -f deploy/lab/docker-compose.lab.yml up -d intake-postgres
// Lauf: DATAPLANE_TEST_DB_URL=postgres://nexora:nexora@127.0.0.1:5433/nexora_intake node --test tests/postgresIntakeRepo.test.js
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const { runMigrations } = require('../src/db/runMigrations');
const { createPostgresIntakeRepo } = require('../src/intake/postgresIntakeRepo');
const { ingestEvent } = require('../src/intake/intakeService');

const URL = process.env.DATAPLANE_TEST_DB_URL;
const SKIP = URL ? {} : { skip: 'DATAPLANE_TEST_DB_URL nicht gesetzt' };

const TENANT = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const COLL = '33333333-3333-4333-8333-333333333333';
const auth = { collectorId: COLL, tenantId: TENANT, siteId: SITE };

let pool; let repo;
const envelope = () => ({
  schemaVersion: '1.0', eventId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  observedAt: '2026-06-24T19:05:20.935Z',
  source: { type: 'flow', vendor: 'conntrack', instanceId: 'vps-hp' },
  raw: { hash: 'a'.repeat(64), ref: 'conntrack:176.65.139.88:54321->203.0.113.246:2222' },
  provenance: { parserVersion: '0.1.0', confidence: 1 },
});

before(async () => {
  if (!URL) return;
  await runMigrations(URL);
  pool = new Pool({ connectionString: URL });
  await pool.query("INSERT INTO tenants (tenant_id,name) VALUES ($1,'lab') ON CONFLICT DO NOTHING", [TENANT]);
  await pool.query("INSERT INTO sites (site_id,tenant_id,name) VALUES ($1,$2,'lab-site') ON CONFLICT DO NOTHING", [SITE, TENANT]);
  await pool.query("INSERT INTO collectors (collector_id,site_id,tenant_id,name,type) VALUES ($1,$2,$3,'conntrack-vps','network_sensor') ON CONFLICT DO NOTHING", [COLL, SITE, TENANT]);
  repo = createPostgresIntakeRepo(pool);
});
beforeEach(async () => { if (pool) await pool.query('TRUNCATE intake_events CASCADE'); });
after(async () => { if (pool) await pool.end(); });

test('ingest persistiert intake_event + outbox ATOMAR', SKIP, async () => {
  const r = await ingestEvent(envelope(), { auth, repo, now: '2026-06-24T19:05:21.000Z' });
  assert.strictEqual(r.status, 'accepted');
  const ev = await pool.query('SELECT * FROM intake_events');
  assert.strictEqual(ev.rowCount, 1);
  assert.strictEqual(ev.rows[0].tenant_id, TENANT);
  assert.strictEqual(ev.rows[0].status, 'accepted');
  const ob = await pool.query('SELECT * FROM intake_outbox');
  assert.strictEqual(ob.rowCount, 1);
  assert.strictEqual(ob.rows[0].intake_event_id, ev.rows[0].intake_id);
  assert.strictEqual(ob.rows[0].status, 'pending');
});

test('Idempotenz: zweites identisches Event → duplicate, kein zweiter Eintrag/Outbox', SKIP, async () => {
  assert.strictEqual((await ingestEvent(envelope(), { auth, repo })).status, 'accepted');
  assert.strictEqual((await ingestEvent(envelope(), { auth, repo })).status, 'duplicate');
  assert.strictEqual(await repo.count(), 1);
  const ob = await pool.query('SELECT count(*)::int AS n FROM intake_outbox');
  assert.strictEqual(ob.rows[0].n, 1);
});
