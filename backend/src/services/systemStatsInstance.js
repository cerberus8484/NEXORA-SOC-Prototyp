'use strict';

const config = require('../config');
const { query } = require('../db/pool');
const { pool } = require('../db/pool');
const { poolSnapshot } = require('../db/poolStats');
const { SystemStatsService } = require('./SystemStatsService');

const systemStatsService = new SystemStatsService({
  query,
  dbEnabled: config.db.enabled,
  poolSnapshot: () => poolSnapshot(pool),
});

module.exports = { systemStatsService };
