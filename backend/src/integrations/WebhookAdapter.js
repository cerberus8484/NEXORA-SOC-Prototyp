'use strict';

const { BaseAdapter }    = require('./BaseAdapter');
const { ValidationError } = require('../errors/AppError');

/**
 * WebhookAdapter — generischer Adapter für Webhook-basierte Quellen.
 *
 * Erwartet ein minimales, selbstbeschreibendes Payload-Format:
 * {
 *   "title":       "Brute Force erkannt",    // Pflicht
 *   "priority":    "high",                   // optional
 *   "externalId":  "OFF-009134",             // optional
 *   "category":    "Authentication Failure", // optional
 *   "srcIp":       "192.168.243.45",         // optional
 *   "dstIp":       "10.0.0.5",             // optional
 *   "datetime":    "2026-06-03T14:05:00Z",  // optional
 *   "description": "...",                   // optional
 * }
 */
class WebhookAdapter extends BaseAdapter {
  constructor(source = 'generic') {
    super(source);
    this.VALID_PRIORITIES = ['critical', 'high', 'medium', 'low', 'info'];
  }

  validate(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new ValidationError('Webhook-Payload muss ein JSON-Objekt sein');
    }
    if (!rawPayload.title || typeof rawPayload.title !== 'string' || !rawPayload.title.trim()) {
      throw new ValidationError('Webhook-Payload: title ist Pflichtfeld');
    }
    if (rawPayload.title.length > 200) {
      throw new ValidationError('Webhook-Payload: title darf max. 200 Zeichen haben');
    }
    if (rawPayload.priority && !this.VALID_PRIORITIES.includes(rawPayload.priority)) {
      throw new ValidationError(`Webhook-Payload: priority muss eines von ${this.VALID_PRIORITIES.join(', ')} sein`);
    }
  }

  normalize(rawPayload) {
    return {
      title:       String(rawPayload.title).trim().slice(0, 200),
      priority:    this.VALID_PRIORITIES.includes(rawPayload.priority) ? rawPayload.priority : 'medium',
      externalId:  rawPayload.externalId  ? String(rawPayload.externalId).slice(0, 200) : '',
      category:    rawPayload.category    ? String(rawPayload.category).slice(0, 200)   : '',
      srcIp:       rawPayload.srcIp       ? String(rawPayload.srcIp).slice(0, 45)       : '',
      dstIp:       rawPayload.dstIp       ? String(rawPayload.dstIp).slice(0, 45)       : '',
      datetime:    rawPayload.datetime    ? String(rawPayload.datetime)                 : '',
      description: rawPayload.description ? String(rawPayload.description).slice(0, 5000) : '',
      source:      this.source,
      raw:         rawPayload,
    };
  }
}

module.exports = { WebhookAdapter };
