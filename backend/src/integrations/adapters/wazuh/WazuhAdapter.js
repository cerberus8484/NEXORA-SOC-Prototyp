'use strict';

const { BaseAdapter }         = require('../../BaseAdapter');
const { alertPayloadSchema }  = require('./wazuhSchemas');
const { mapAlertToNormalized } = require('./wazuhMapper');
const { ValidationError }     = require('../../../errors/AppError');

class WazuhAdapter extends BaseAdapter {
  constructor() {
    super('wazuh');
  }

  validate(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new ValidationError('Wazuh-Payload muss ein JSON-Objekt sein');
    }

    const { error } = alertPayloadSchema.validate(rawPayload);
    if (error) {
      const details = error.details.map(d => ({
        field:   d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      throw new ValidationError('Wazuh-Payload ungültig', details);
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
      // ADR-007: neues Modell — frisch eingehende Offense ist ein offener, zugewiesener Case.
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

module.exports = { WazuhAdapter };
