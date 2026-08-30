'use strict';

// Geteilte WazuhIndexerClient-Instanz für die SIEM-Dashboard-Route.
const { WazuhIndexerClient } = require('./WazuhIndexerClient');
const config                 = require('../../../config');

const wazuhIndexerClient = new WazuhIndexerClient(config.wazuhIndexer);

module.exports = { wazuhIndexerClient };
