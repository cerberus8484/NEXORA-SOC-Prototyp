'use strict';

const { MlEvalExportService } = require('./MlEvalExportService');
const { agentService } = require('./agentServiceInstance');
const { ticketService } = require('./TicketService');

const mlEvalExportService = new MlEvalExportService({
  agentSuggestionRepo: agentService._repo,
  ticketRepo: ticketService._repo,
});

module.exports = { mlEvalExportService };
