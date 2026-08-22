'use strict';

const { auditService }  = require('../../../services/AuditService');
const { ticketService } = require('../../../services/TicketService');
const logger            = require('../../../logger');
const { enrichDraftWithPhishing } = require('./phishingEnrichment');

/**
 * EmailProcessor — normalisierte Alert-Mails → Tickets.
 *
 * Dedup-Regel (restart-sicher, gegen Tickets-Tabelle, identisch zu QRadarProcessor):
 *   offenseId = email:msg:<messageId>
 *   Offenes Ticket mit dieser offenseId vorhanden → UPDATE (Recurrence + Priority-Refresh)
 *   Keins offen                                  → CREATE
 *
 * Datenschutz: Es werden keine vollen Mail-Bodies geloggt — nur externalId,
 * Ticket-ID und Priority.
 */
class EmailProcessor {
  /**
   * @param {object} tickets — injizierter TicketService (Standard: globaler Singleton).
   */
  constructor(tickets = ticketService) {
    this._tickets = tickets;
  }

  async process(normalizedData) {
    const offenseId = normalizedData.externalId;
    const existing = offenseId
      ? await this._tickets.findOpenByOffense('email', offenseId)
      : null;
    return existing
      ? this._update(existing, normalizedData)
      : this._create(normalizedData);
  }

  async _create(normalizedData) {
    // Phishing-Triage: Roh-Mail parsen, extrahierte IOCs + Indikatoren in den
    // Draft mergen. Fail-safe — ein Parser-Fehler verschluckt das Ticket nicht
    // (enrichDraftWithPhishing warnt und liefert die Basis-Felder unverändert).
    const enriched = enrichDraftWithPhishing(normalizedData.raw, {
      description: normalizedData.description,
      iocs:        '',
    });

    const draft = {
      title:       normalizedData.title,
      category:    normalizedData.category,
      priority:    normalizedData.priority,
      state:       'OPEN',
      status:      'assigned',
      source:      'email',
      kind:        'alert',
      datetime:    normalizedData.datetime,
      srcIp:       normalizedData.srcIp,
      dstIp:       normalizedData.dstIp,
      description: enriched.description,
      iocs:        enriched.iocs,
      offenseId:   normalizedData.externalId,
      alertCount:  1,
    };

    const ticket = await this._tickets.create(draft);

    await auditService.write({
      action:     'EMAIL_TICKET_CREATED',
      targetType: 'ticket',
      targetId:   ticket.id,
      metadata:   {
        externalId: normalizedData.externalId,
        title:      ticket.title,
        priority:   ticket.priority,
        phishingIndicators: enriched.phishingIndicatorCount,
      },
    });

    logger.info('email_ticket_created', {
      ticketId: ticket.id,
      externalId: normalizedData.externalId,
      phishingIndicators: enriched.phishingIndicatorCount,
    });
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
      action:     'EMAIL_TICKET_UPDATED',
      targetType: 'ticket',
      targetId:   existing.id,
      metadata:   { externalId: normalizedData.externalId, priority: normalizedData.priority, alertCount },
    });

    logger.info('email_ticket_updated', { ticketId: existing.id, externalId: normalizedData.externalId, alertCount });
    return { action: 'updated', ticketId: existing.id, alertCount };
  }
}

module.exports = { EmailProcessor };
