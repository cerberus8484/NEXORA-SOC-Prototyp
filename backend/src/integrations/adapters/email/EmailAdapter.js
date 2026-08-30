'use strict';

const { BaseAdapter }           = require('../../BaseAdapter');
const { emailPayloadSchema }    = require('./emailSchemas');
const { mapEmailToNormalized }  = require('./emailMapper');
const { ValidationError }       = require('../../../errors/AppError');

class EmailAdapter extends BaseAdapter {
  constructor() {
    super('email');
  }

  /**
   * Validiert eingehenden Mail-Payload.
   * Wirft ValidationError bei fehlenden Pflichtfeldern.
   */
  validate(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new ValidationError('E-Mail-Payload muss ein JSON-Objekt sein');
    }

    const { error } = emailPayloadSchema.validate(rawPayload);
    if (error) {
      const details = error.details.map((d) => ({
        field:   d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      throw new ValidationError('E-Mail-Payload ungültig', details);
    }
  }

  /**
   * Mail → normalisiertes Format.
   * Raw Payload bleibt als Evidence erhalten (Traceability!).
   */
  normalize(rawPayload) {
    return mapEmailToNormalized(rawPayload, this.source);
  }

  /**
   * Normalisierte Daten → Ticket-Draft.
   */
  toTicketDraft(normalizedData) {
    return {
      title:       normalizedData.title,
      category:    normalizedData.category,
      priority:    normalizedData.priority,
      status:      normalizedData.status,
      source:      normalizedData.source,
      datetime:    normalizedData.datetime,
      srcIp:       normalizedData.srcIp,
      dstIp:       normalizedData.dstIp,
      description: normalizedData.description,
      offenseId:   normalizedData.externalId,
    };
  }
}

module.exports = { EmailAdapter };
