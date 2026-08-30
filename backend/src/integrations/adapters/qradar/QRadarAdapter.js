'use strict';

const { BaseAdapter }            = require('../../BaseAdapter');
const { offensePayloadSchema }   = require('./qradarSchemas');
const { mapOffenseToNormalized } = require('./qradarMapper');
const { ValidationError }        = require('../../../errors/AppError');

class QRadarAdapter extends BaseAdapter {
  constructor({ baseUrl = '' } = {}) {
    super('qradar');
    // Config einmal im Adapter lesen — Mapper bleibt frei von process.env
    this._baseUrl = baseUrl || process.env.QRADAR_BASE_URL || '';
  }

  /**
   * Validiert QRadar Offense-Payload.
   * Wirft ValidationError bei fehlenden Pflichtfeldern.
   */
  validate(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new ValidationError('QRadar-Payload muss ein JSON-Objekt sein');
    }

    const { error } = offensePayloadSchema.validate(rawPayload);
    if (error) {
      const details = error.details.map(d => ({
        field:   d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      throw new ValidationError('QRadar-Payload ungültig', details);
    }
  }

  /**
   * QRadar Offense → normalisiertes Format.
   * Raw Payload bleibt als Evidence erhalten (Traceability!).
   */
  normalize(rawPayload) {
    return mapOffenseToNormalized(rawPayload, this.source, { baseUrl: this._baseUrl });
  }

  /**
   * Normalisierte Daten → Ticket-Draft.
   * Wird in P10.3 für Ticket Create/Update genutzt.
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

module.exports = { QRadarAdapter };
