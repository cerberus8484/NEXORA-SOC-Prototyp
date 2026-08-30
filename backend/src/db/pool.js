'use strict';

const { Pool } = require('pg');
const config   = require('../config');
const logger   = require('../logger');
const { buildPoolConfig } = require('./poolConfig');
const { logPoolSaturation } = require('./poolStats');
const { metrics } = require('../metrics/metricsRegistry');

// Eine Query gilt als Timeout, wenn Postgres sie via statement_timeout abbricht
// (SQLSTATE 57014 query_canceled) ODER node-postgres clientseitig per query_timeout.
function isTimeoutError(err) {
  return err && (err.code === '57014' || /timeout/i.test(err.message || ''));
}

// Verbindungsparameter + harte Timeouts aus ENV (buildPoolConfig, rein/testbar).
// statement_timeout/query_timeout begrenzen lange Queries; connectionTimeoutMillis
// verhindert endloses Warten auf eine Verbindung bei Pool-Sättigung.
const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  logger.error('pg_pool_error', { message: err.message, stack: err.stack });
});

pool.on('connect', () => {
  logger.info('pg_pool_connect');
});

// Einfacher Query-Helper mit Logging
async function query(sql, params = []) {
  // Pool-Sättigung sichtbar machen, BEVOR diese Query auf eine Verbindung wartet.
  // Reine Zähler-Prüfung (kein DB-Zugriff) → vernachlässigbarer Overhead.
  if (logPoolSaturation(pool, logger)) metrics.dbPoolSaturationWarningsTotal.inc();
  const start = Date.now();
  try {
    const result = await pool.query(sql, params);
    logger.debug('pg_query', {
      durationMs: Date.now() - start,
      rows:       result.rowCount,
    });
    return result;
  } catch (err) {
    if (isTimeoutError(err)) metrics.dbQueryTimeoutsTotal.inc();
    logger.error('pg_query_error', {
      message:    err.message,
      durationMs: Date.now() - start,
    });
    throw err;
  }
}

// Health-Check: kann die DB erreicht werden?
async function ping() {
  const result = await query('SELECT 1 AS ok');
  return result.rows[0].ok === 1;
}

// Migrationen ausführen — MIT Tracking-Tabelle: jede SQL-Datei läuft genau EINMAL,
// nicht bei jedem Boot erneut (das war ein Footgun — eine einzige nicht-idempotente
// Migration hätte die Prod-DB bei jedem Deploy beschädigt).
//
// Rückwärtskompatibel: auf einer bestehenden DB ist `schema_migrations` zunächst leer
// → alle Dateien laufen EINMAL idempotent durch (IF NOT EXISTS greift) und werden
// erfasst; ab dann übersprungen. queryFn injizierbar (Test).
async function migrate(queryFn = query) {
  const fs   = require('fs');
  const path = require('path');
  const dir  = path.join(__dirname, 'migrations');

  await queryFn(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const appliedRes = await queryFn('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedRes.rows.map(r => r.filename));

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    logger.info('pg_migrate', { file });
    await queryFn(sql);
    await queryFn('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
    ran += 1;
  }
  logger.info('pg_migrate_done', { total: files.length, ran, skipped: files.length - ran });
}

module.exports = { pool, query, ping, migrate };
