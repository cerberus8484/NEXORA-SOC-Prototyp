'use strict';

const { Pool } = require('pg');
const logger   = require('../logger');
const { buildPoolConfig } = require('./poolConfig');

// Eigener KLEINER Pool nur für Health-Checks. Damit kann ein gesättigter API-Pool
// den Health-Status nicht fälschlich auf 'error' kippen (Health bleibt aussagekräftig).
// Bewusst schnelle Timeouts: Health soll zügig scheitern statt zu hängen.
const healthPool = new Pool({
  ...buildPoolConfig(),
  max:                     parseInt(process.env.DB_HEALTH_POOL_MAX            || '2',    10),
  connectionTimeoutMillis: parseInt(process.env.DB_HEALTH_CONNECTION_TIMEOUT_MS || '2000', 10),
  statement_timeout:       parseInt(process.env.DB_HEALTH_STATEMENT_TIMEOUT_MS  || '2000', 10),
  query_timeout:           parseInt(process.env.DB_HEALTH_QUERY_TIMEOUT_MS      || '2000', 10),
});

healthPool.on('error', (err) => logger.error('pg_health_pool_error', { message: err.message }));

// Erreichbarkeit prüfen — wirft bei Verbindungs-/Timeout-Fehler (vom Checker gefangen).
async function healthPing() {
  const res = await healthPool.query('SELECT 1 AS ok');
  return res.rows[0].ok === 1;
}

module.exports = { healthPool, healthPing };
