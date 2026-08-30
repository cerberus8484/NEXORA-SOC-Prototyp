'use strict';

const { BaseAdapter }          = require('../../BaseAdapter');
const { alertPayloadSchema }   = require('./splunkSchemas');
const { mapAlertToNormalized } = require('./splunkMapper');
const { ValidationError }      = require('../../../errors/AppError');

class SplunkAdapter extends BaseAdapter {
  constructor({ baseUrl = '' } = {}) {
    super('splunk');
    this._baseUrl = baseUrl || process.env.SPLUNK_BASE_URL || '';
  }

  validate(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new ValidationError('Splunk-Payload muss ein JSON-Objekt sein');
    }
    // Mindestanforderung: sid oder search_name oder result.rule_name
    const r = rawPayload.result || {};
    const hasId = rawPayload.sid || rawPayload.search_name ||
                  r.rule_name || r.rule_title || r.event_id;
    if (!hasId) {
      throw new ValidationError(
        'Splunk-Payload: mindestens eines der Felder sid, search_name oder result.rule_name ist erforderlich'
      );
    }

    const { error } = alertPayloadSchema.validate(rawPayload);
    if (error) {
      const details = error.details.map(d => ({
        field:   d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      throw new ValidationError('Splunk-Payload ungültig', details);
    }
  }

  normalize(rawPayload) {
    return mapAlertToNormalized(rawPayload, this.source, { baseUrl: this._baseUrl });
  }

  toTicketDraft(normalizedData) {
    return {
      title:       normalizedData.title,
      category:    normalizedData.category,
      priority:    normalizedData.priority,
      status:      normalizedData.status,
      source:      normalizedData.source,
      datetime:    normalizedData.datetime,
      srcIp:       normalizedData.srcIp,
      srcFqdn:     normalizedData.srcFqdn,
      dstIp:       normalizedData.dstIp,
      dstFqdn:     normalizedData.dstFqdn,
      port:        normalizedData.port,
      protocol:    normalizedData.protocol,
      user:        normalizedData.user,
      mitre:       normalizedData.mitre,
      description: normalizedData.description,
      offenseId:   normalizedData.externalId,
    };
  }
}

module.exports = { SplunkAdapter };
