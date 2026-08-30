'use strict';

// Boot des Intake-Servers (Container-Entrypoint).
//
// DATAPLANE_DB_URL gesetzt → Postgres-Repo (Transactional Outbox) + ECHTE Credential-
// Auflösung gegen collector_credentials (Pro-Collector-Identität, SHA-256). Migrationen
// laufen beim Boot.
// Ohne DB_URL → InMemory + Dev-Stub-Auth (ein Token), NUR für lokale Entwicklung —
// mit lauter Warnung, kein stiller Datenverlust. In Produktion ohne DB → harter Abbruch.
const { createIntakeApp } = require('./server');
const { createInMemoryIntakeRepo } = require('./inMemoryIntakeRepo');
const { createPostgresIntakeRepo } = require('./postgresIntakeRepo');
const { createCollectorAuthResolver } = require('./postgresAuthResolver');
const { createRateLimiter } = require('./rateLimit');

const DEV_CREDENTIAL = process.env.INTAKE_DEV_CREDENTIAL || 'dev-collector-token';
const DB_URL = process.env.DATAPLANE_DB_URL || '';
const IS_PROD = process.env.NODE_ENV === 'production';

function log(o) { process.stderr.write(JSON.stringify({ svc: 'nexora-intake', ...o }) + '\n'); }

// Dev-Stub-Auth: ein Credential aus ENV → fixe Collector-Identität (nur ohne DB).
function devResolveAuth(req) {
  const cred = req.get('x-collector-credential');
  if (!cred || cred !== DEV_CREDENTIAL) return null;
  return {
    collectorId: process.env.INTAKE_DEV_COLLECTOR_ID || 'col-dev-01',
    tenantId: process.env.INTAKE_DEV_TENANT || 'tenant-dev',
    siteId: process.env.INTAKE_DEV_SITE || 'site-dev',
  };
}

async function buildBackends() {
  if (DB_URL) {
    const { Pool } = require('pg');
    const { runMigrations } = require('../db/runMigrations');
    await runMigrations(DB_URL);
    const pool = new Pool({ connectionString: DB_URL });
    log({ msg: 'backend: postgres (persistent + outbox + credential-auth)' });
    return { repo: createPostgresIntakeRepo(pool), resolveAuth: createCollectorAuthResolver({ pool }) };
  }
  if (IS_PROD) {
    throw new Error('DATAPLANE_DB_URL erforderlich in Produktion (InMemory + Dev-Stub-Auth nicht zulässig)');
  }
  log({ msg: '⚠ WARNUNG: InMemory-Repo + Dev-Stub-Auth — KEINE Persistenz, EIN Token für alle. Nur lokale Entwicklung.' });
  return { repo: createInMemoryIntakeRepo(), resolveAuth: devResolveAuth };
}

async function main() {
  const { repo, resolveAuth } = await buildBackends();
  const rateLimit = createRateLimiter({
    limit: Number(process.env.INTAKE_RATE_LIMIT || 6000) || 6000,
    windowMs: Number(process.env.INTAKE_RATE_WINDOW_MS || 60000) || 60000,
  });
  const app = createIntakeApp({ repo, resolveAuth, rateLimit });
  const port = Number(process.env.PORT || 8081);
  app.listen(port, () => log({ msg: 'listening', port }));
}

main().catch((err) => { log({ msg: 'fatal', error: err.message }); process.exit(1); });
