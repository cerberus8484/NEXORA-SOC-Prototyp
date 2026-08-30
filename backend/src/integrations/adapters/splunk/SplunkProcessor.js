'use strict';

const { auditService }  = require('../../../services/AuditService');
const { ticketService } = require('../../../services/TicketService');
const logger            = require('../../../logger');

/**
 * SplunkProcessor — normalisierte Splunk-Notable-Events → Tickets.
 *
 * Dedup-Regel (restart-sicher, gegen Tickets-Tabelle, identisch zu QRadar/Email):
 *   offenseId = <Splunk externalId>
 *   Offenes Ticket mit dieser offenseId vorhanden → UPDATE (Recurrence + Priority-Refresh)
 *   Keins offen                                  → CREATE
 *
 * Vorher dedupte der Processor über eine prozess-lokale In-Memory-Map (#3b) —
 * die ging bei jedem API-Neustart verloren → doppelte Splunk-Tickets. Jetzt kein
 * In-Memory-only-State: funktioniert auch nach Server-Neustart korrekt.
 */
class SplunkProcessor {
  /**
   * @param {object} tickets — injizierter TicketService (Standard: globaler Singleton).
   *   Erlaubt Unit-Tests ohne globalen State.
   */
  constructor(tickets = ticketService) {
    this._tickets = tickets;
  }

  async process(normalizedData) {
    const offenseId = normalizedData.externalId;
    const existing  = offenseId
      ? await this._tickets.findOpenByOffense('splunk', offenseId)
      : null;
    return existing
      ? this._update(existing, normalizedData)
      : this._create(normalizedData);
  }

  async _create(normalizedData) {
    const ticket = await this._tickets.create({
      title:       normalizedData.title,
      category:    normalizedData.category,
      priority:    normalizedData.priority,
      status:      normalizedData.status,
      source:      'splunk',
      datetime:    normalizedData.datetime,
      srcIp:       normalizedData.srcIp,
      srcFqdn:     normalizedData.srcFqdn,
      dstIp:       normalizedData.dstIp,
      user:        normalizedData.user,
      mitre:       normalizedData.mitre,
      description: normalizedData.description,
      offenseId:   normalizedData.externalId,
      alertCount:  1,
    });

    await auditService.write({
      action:     'SPLUNK_TICKET_CREATED',
      targetType: 'ticket', targetId: ticket.id,
      metadata:   { externalId: normalizedData.externalId, title: ticket.title, priority: ticket.priority },
    });

    logger.info('splunk_ticket_created', { ticketId: ticket.id, externalId: normalizedData.externalId });
    return { action: 'created', ticketId: ticket.id };
  }

  async _update(existing, normalizedData) {
    const alertCount = (existing.alertCount || 1) + 1;
    const updates = {
      priority:    normalizedData.priority,
      status:      normalizedData.status,
      description: normalizedData.description,
      alertCount,
    };
    await this._tickets.update(existing.id, updates);

    await auditService.write({
      action:     'SPLUNK_TICKET_UPDATED',
      targetType: 'ticket', targetId: existing.id,
      metadata:   { externalId: normalizedData.externalId, updates },
    });

    logger.info('splunk_ticket_updated', { ticketId: existing.id, externalId: normalizedData.externalId, alertCount });
    return { action: 'updated', ticketId: existing.id, alertCount };
  }
}

module.exports = { SplunkProcessor };
