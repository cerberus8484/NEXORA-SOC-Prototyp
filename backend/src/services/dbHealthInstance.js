'use strict';

const { createDbHealthChecker } = require('./dbHealthChecker');
const { healthPing } = require('../db/healthPool');

// Singleton: gecachter, fehlersicherer DB-Health-Check auf dem eigenen Health-Pool.
// TTL drosselt die Last; timeoutMs begrenzt einen hängenden Ping.
const dbHealthChecker = createDbHealthChecker({
  ping:      healthPing,
  ttlMs:     parseInt(process.env.DB_HEALTH_CACHE_TTL_MS || '3000', 10),
  timeoutMs: parseInt(process.env.DB_HEALTH_TIMEOUT_MS   || '2000', 10),
});

module.exports = { dbHealthChecker };
