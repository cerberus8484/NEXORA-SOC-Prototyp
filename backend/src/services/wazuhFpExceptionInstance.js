'use strict';

// Geteilte Service-Instanz (Repo via Factory, Wazuh-API-Client, Audit).
const config = require('../config');
const { WazuhFpExceptionService } = require('./WazuhFpExceptionService');
const { createWazuhFpExceptionRepository } = require('../repositories/wazuhFpExceptionRepositoryFactory');
const { wazuhApiClient } = require('../integrations/adapters/wazuh/wazuhApiInstance');
const { auditService }   = require('./AuditService');

const wazuhFpExceptionService = new WazuhFpExceptionService({
  repo: createWazuhFpExceptionRepository(),
  apiClient: wazuhApiClient,
  audit: auditService,
  applyEnabled: config.wazuh.fpApplyEnabled, // SAFETY GATE (default false)
});

module.exports = { wazuhFpExceptionService };
