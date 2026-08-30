'use strict';

// Layer 2: die effektiven Outbound-Ticket-Verbindungen (DB > ENV) auf die
// Singleton-Adapter (ServiceNow/OTRS in externalTicketInstance) anwenden — beim Boot
// (nach DB-Start) und nach jedem PUT /servicenow|otrs/connection. Kein Neustart nötig.
//
// Getrennt reconfigurierbar: der Applier resolved beide unabhängig, damit ein Fehler
// bei einer Quelle die andere nicht verhindert.

const { createSettingsRepository }      = require('../repositories/settingsRepositoryFactory');
const { resolveServicenowConnection }   = require('../services/servicenowConnectionSettings');
const { resolveOtrsConnection }         = require('../services/otrsConnectionSettings');
const { externalTicketService }         = require('./externalTicketInstance');
const logger                            = require('../logger');

async function applyExternalTicketConnections(repo = null) {
  const settingsRepo = repo || createSettingsRepository();

  // Beide Verbindungen sind unabhängige Lesevorgänge → parallel resolven (kein
  // Grund, die zweite DB-Abfrage auf die erste warten zu lassen).
  const [sn, otrs] = await Promise.all([
    resolveServicenowConnection(settingsRepo),
    resolveOtrsConnection(settingsRepo),
  ]);

  externalTicketService.reconfigureAdapter('servicenow', {
    baseUrl: sn.baseUrl, username: sn.username, password: sn.password, table: sn.table,
  });

  externalTicketService.reconfigureAdapter('otrs', {
    baseUrl: otrs.baseUrl, username: otrs.username, password: otrs.password,
    queue: otrs.queue, webService: otrs.webService, operation: otrs.operation,
  });

  // Nur die Quellen loggen — NIE URLs/User/Passwörter (Log-Hygiene).
  logger.info('external_ticket_connections_applied', { servicenowSource: sn.source, otrsSource: otrs.source });
  return { servicenow: sn.source, otrs: otrs.source };
}

module.exports = { applyExternalTicketConnections };
