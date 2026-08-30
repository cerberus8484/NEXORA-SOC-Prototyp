'use strict';

const config = require('../config');
const { authService } = require('./AuthService');
const { auditService } = require('./AuditService');
const { SystemControlService } = require('./systemControlService');

const systemControlService = new SystemControlService({
  config,
  authService,
  auditService,
});

module.exports = { systemControlService };
