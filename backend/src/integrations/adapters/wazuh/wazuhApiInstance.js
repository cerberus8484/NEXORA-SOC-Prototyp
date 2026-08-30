'use strict';

// Geteilte WazuhApiClient-Instanz (ein Token-Cache für Processor + Hosts-Route).
const { WazuhApiClient } = require('./WazuhApiClient');
const config             = require('../../../config');

const wazuhApiClient = new WazuhApiClient(config.wazuhApi);

module.exports = { wazuhApiClient };
