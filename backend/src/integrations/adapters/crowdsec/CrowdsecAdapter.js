'use strict';

// CrowdsecAdapter — normalisiert WAN-Alerts vom Webserver-CrowdSec in den
// Nexora-Ticket-Vertrag (Adapter-Pflicht: validate -> normalize -> toTicketDraft).
// Transport-unabhängig: der LAPI-Client/Poller füttert einzelne Alert-Objekte rein.

const { BaseAdapter }          = require('../../BaseAdapter');
const { alertSchema }          = require('./crowdsecSchemas');
const { mapAlertToNormalized } = require('./crowdsecMapper');
const { ValidationError }      = require('../../../errors/AppError');

class CrowdsecAdapter extends BaseAdapter {
  constructor() {
    super('crowdsec');
  }

  validate(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new ValidationError('CrowdSec-Alert muss ein JSON-Objekt sein');
    }
    const { error } = alertSchema.validate(rawPayload);
    if (error) {
      const details = error.details.map((d) => ({
        field:   d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      throw new ValidationError('CrowdSec-Alert ungültig', details);
    }
  }

  normalize(rawPayload) {
    return mapAlertToNormalized(rawPayload, this.source);
  }

  toTicketDraft(normalizedData) {
    return {
      title:       normalizedData.title,
      category:    normalizedData.category,
      priority:    normalizedData.priority,
      // ADR-007: frisch eingehender WAN-Alert ist ein offener, zugewiesener Case.
      state:       'OPEN',
      status:      'assigned',
      source:      normalizedData.source,
      datetime:    normalizedData.datetime,
      srcIp:       normalizedData.srcIp,
      dstIp:       normalizedData.dstIp,
      description: normalizedData.description,
      offenseId:   normalizedData.externalId,
    };
  }
}

module.exports = { CrowdsecAdapter };
