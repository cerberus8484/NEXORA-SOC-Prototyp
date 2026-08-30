'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const { runMigrations } = require('../src/db/runMigrations');
const { createPostgresIntakeRepo } = require('../src/intake/postgresIntakeRepo');
const { ingestEvent } = require('../src/intake/intakeService');
const { createPostgresOutboxStore } = require('../src/engine/postgresOutboxStore');
const { createOutboxWorker } = require('../src/engine/outboxWorker');
const { gatherDbCounts } = require('../src/status/gatherDbCounts');

const URL = process.env.DATAPLANE_PROOF_DB_URL || process.env.DATAPLANE_TEST_DB_URL || 'postgres://nexora:nexora@127.0.0.1:55433/nexora_intake_proof';
const TENANT = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const COLL = '33333333-3333-4333-8333-333333333333';

function envelope(i, pair = 0) {
  return {
    schemaVersion: '1.0',
    eventId: crypto.randomUUID(),
    observedAt: new Date(Date.now() + i * 1000).toISOString(),
    source: { type: 'ids', vendor: 'suricata', instanceId: `sensor-${pair}` },
    raw: { hash: crypto.createHash('sha256').update(`proof-${pair}-${i}`).digest('hex'), ref: `proof:${pair}:${i}` },
    provenance: { parserVersion: 'proof-1.0.0', confidence: 0.91 },
    normalized: {
      network: {
        srcIp: `45.143.200.${10 + pair}`,
        dstIp: `198.51.100.${20 + pair}`,
        dstPort: 2222,
        protocol: 'tcp',
      },
      alert: {
        signature: `Proof signature ${pair}`,
        severity: 1,
      },
      entities: [
        { type: 'ip', value: `45.143.200.${10 + pair}`, role: 'source' },
        { type: 'ip', value: `198.51.100.${20 + pair}`, role: 'destination' },
      ],
    },
  };
}

async function seedMetadata(pool) {
  await pool.query("INSERT INTO tenants (tenant_id, name) VALUES ($1, 'proof') ON CONFLICT DO NOTHING", [TENANT]);
  await pool.query("INSERT INTO sites (site_id, tenant_id, name) VALUES ($1, $2, 'proof-site') ON CONFLICT DO NOTHING", [SITE, TENANT]);
  await pool.query(
    "INSERT INTO collectors (collector_id, site_id, tenant_id, name, type) VALUES ($1, $2, $3, 'proof-collector', 'network_sensor') ON CONFLICT DO NOTHING",
    [COLL, SITE, TENANT],
  );
}

async function resetTables(pool) {
  await pool.query('TRUNCATE intake_events CASCADE');
}

async function ingestMany(repo, count, pair = 0) {
  const auth = { collectorId: COLL, tenantId: TENANT, siteId: SITE };
  for (let i = 0; i < count; i += 1) {
    const result = await ingestEvent(envelope(i, pair), { auth, repo });
    if (result.status !== 'accepted') throw new Error(`ingestEvent fehlgeschlagen: ${JSON.stringify(result)}`);
  }
}

async function main() {
  await runMigrations(URL);
  const pool = new Pool({ connectionString: URL });
  try {
    await seedMetadata(pool);
    const repo = createPostgresIntakeRepo(pool);
    const store = createPostgresOutboxStore(pool);

    await resetTables(pool);
    await ingestMany(repo, 24, 1);
    const backlogBeforeDrain = await gatherDbCounts(pool);

    let emitted = 0;
    const successWorker = createOutboxWorker({
      store,
      emit: async () => { emitted += 1; },
      limit: 100,
      now: () => new Date('2026-07-06T12:00:00.000Z').toISOString(),
    });
    const successRun = await successWorker.runOnce();
    const backlogAfterDrain = await gatherDbCounts(pool);

    await resetTables(pool);
    await ingestMany(repo, 8, 2);
    const retryBefore = await gatherDbCounts(pool);

    const failingWorker = createOutboxWorker({
      store,
      emit: async () => { throw new Error('simulated ingress outage'); },
      limit: 100,
      backoffMs: 1000,
      maxAttempts: 5,
      now: () => '2026-07-06T12:10:00.000Z',
    });
    const retryRun = await failingWorker.runOnce();
    const retryAfterFailure = await gatherDbCounts(pool);

    let retryDrainEmitted = 0;
    const retryDrainWorker = createOutboxWorker({
      store,
      emit: async () => { retryDrainEmitted += 1; },
      limit: 100,
      now: () => '2026-07-06T12:10:02.000Z',
    });
    const retryDrainRun = await retryDrainWorker.runOnce();
    const retryAfterDrain = await gatherDbCounts(pool);

    const report = {
      dbUrl: URL,
      drainProof: {
        before: backlogBeforeDrain,
        workerRun: successRun,
        emittedIncidents: emitted,
        after: backlogAfterDrain,
      },
      retryProof: {
        before: retryBefore,
        failedEmitRun: retryRun,
        afterFailure: retryAfterFailure,
        drainRun: retryDrainRun,
        emittedIncidentsAfterRecovery: retryDrainEmitted,
        afterRecovery: retryAfterDrain,
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
