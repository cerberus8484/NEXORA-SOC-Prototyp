'use strict';

const { auditService }  = require('../../../services/AuditService');
const { ticketService } = require('../../../services/TicketService');
const logger            = require('../../../logger');

/**
 * QRadarProcessor — normalisierte QRadar-Offenses → Tickets.
 *
 * Dedup-Regel (restart-sicher, gegen Tickets-Tabelle, identisch zu WazuhProcessor):
 *   offenseId = qradar:offense:<id>
 *   Offenes Ticket mit dieser offenseId vorhanden → UPDATE (Recurrence + Priority-Refresh)
 *   Keins offen                                  → CREATE
 *
 * Kein separates ExternalLink-Repo, kein In-Memory-only-State —
 * funktioniert nach Server-Neustart korrekt.
 */
class QRadarProcessor {
  /**
   * @param {object} tickets — injizierter TicketService (Standard: globaler Singleton).
   *   Erlaubt Unit-Tests ohne globalen State.
   */
  constructor(tickets = ticketService) {
    this._tickets = tickets;
  }

  async process(normalizedData) {
    const offenseId = normalizedData.externalId;
    const existing = offenseId
      ? await this._tickets.findOpenByOffense('qradar', offenseId)
      : null;
    return existing
      ? this._update(existing, normalizedData)
      : this._create(normalizedData);
  }

  async _create(normalizedData) {
    const draft = {
      title:       normalizedData.title,
      category:    normalizedData.category,
      priority:    normalizedData.priority,
      state:       'OPEN',
      status:      'assigned',
      source:      'qradar',
      kind:        'alert',
      datetime:    normalizedData.datetime,
      srcIp:       normalizedData.srcIp,
      dstIp:       normalizedData.dstIp,
      description: normalizedData.description,
      offenseId:   normalizedData.externalId,
      alertCount:  1,
    };

    const ticket = await this._tickets.create(draft);

    await auditService.write({
      action:     'QRADAR_TICKET_CREATED',
      targetType: 'ticket',
      targetId:   ticket.id,
      metadata:   { externalId: normalizedData.externalId, title: ticket.title, priority: ticket.priority },
    });

    logger.info('qradar_ticket_created', { ticketId: ticket.id, externalId: normalizedData.externalId });
    return { action: 'created', ticketId: ticket.id };
  }

  async _update(existing, normalizedData) {
    const alertCount = (existing.alertCount || 1) + 1;

    await this._tickets.update(existing.id, {
      priority:    normalizedData.priority,
      description: normalizedData.description,
      alertCount,
    });

    await auditService.write({
      action:     'QRADAR_TICKET_UPDATED',
      targetType: 'ticket',
      targetId:   existing.id,
      metadata:   { externalId: normalizedData.externalId, priority: normalizedData.priority, alertCount },
    });

    logger.info('qradar_ticket_updated', { ticketId: existing.id, externalId: normalizedData.externalId, alertCount });
    return { action: 'updated', ticketId: existing.id, alertCount };
  }
}

module.exports = { QRadarProcessor };
