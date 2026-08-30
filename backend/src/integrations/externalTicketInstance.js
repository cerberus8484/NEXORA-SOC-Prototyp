'use strict';

// Geteilte Outbound-Export-Instanz (P12). ServiceNow + OTRS werden IMMER registriert,
// senden aber nur, wenn ihre *_BASE_URL + Credentials gesetzt sind (Adapter lesen ENV).
// Sonst wirft sendTicket() einen klaren Konfigurations-Fehler. Master-Schalter
// (config.externalTicket.enabled) gated die Route — beides default inert.
//
// Persistenz: ExternalLink wird über die Domänen-Factory gewählt — Postgres bei
// DB_ENABLED (restart-fest, #3a), sonst InMemory (Tests/Dev, flüchtig). Damit
// überlebt die Outbound-Export-Dedup einen API-Neustart und ServiceNow/OTRS-Exporte
// gehen nicht doppelt raus. Das Audit-Log (EXTERNAL_TICKET_EXPORT_*) bleibt zusätzlich.
const { ExternalTicketService } = require('./ExternalTicketService');
const { ServiceNowAdapter }     = require('./adapters/servicenow/ServiceNowAdapter');
const { OTRSAdapter }           = require('./adapters/otrs/OTRSAdapter');
const { createExternalLinkRepository } = require('../repositories/externalLinkRepositoryFactory');

const externalTicketService = new ExternalTicketService(
  {
    servicenow: new ServiceNowAdapter(),
    otrs:       new OTRSAdapter(),
  },
  createExternalLinkRepository(),
);

module.exports = { externalTicketService };
