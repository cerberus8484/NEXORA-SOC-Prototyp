'use strict';

/**
 * ExternalTicketAdapter — Interface für OUTBOUND Ticket-Export.
 *
 * Bewusst getrennt von BaseAdapter:
 *   BaseAdapter       = INBOUND  (extern → intern: normalize, validate)
 *   ExternalTicketAdapter = OUTBOUND (intern → extern: export, mapToExternal)
 *
 * Jedes externe Ticketsystem (ServiceNow, OTRS, Jira, ...) implementiert dieses Interface.
 */
class ExternalTicketAdapter {
  constructor(system) {
    if (!system) throw new Error('ExternalTicketAdapter benötigt einen system-Namen');
    this.system = system;
  }

  /**
   * Internes Ticket → externes Payload.
   * @param {Ticket} ticket
   * @returns {object} systemspezifisches Payload
   */
  // eslint-disable-next-line no-unused-vars
  mapToExternal(ticket) { this._ni('mapToExternal'); }

  /**
   * Externes Payload validieren (bevor es gesendet wird).
   * @param {object} externalPayload
   */
  // eslint-disable-next-line no-unused-vars
  validateExternalPayload(externalPayload) { this._ni('validateExternalPayload'); }

  /**
   * Externes Ticket-Payload an das Zielsystem senden.
   * P12.1: noch nicht implementiert — nur Vertrag.
   * P12.2+: echte HTTP-Calls.
   * @param {object} externalPayload
   * @returns {Promise<{externalId, externalUrl}>}
   */
  // eslint-disable-next-line no-unused-vars
  async sendTicket(externalPayload) { this._ni('sendTicket'); }

  /**
   * Status eines externen Tickets aktualisieren (P12.4+).
   */
  // eslint-disable-next-line no-unused-vars
  async updateTicketStatus(externalId, status) { this._ni('updateTicketStatus'); }

  _ni(m) { throw new Error(`${this.constructor.name}.${m}() nicht implementiert`); }
}

module.exports = { ExternalTicketAdapter };
