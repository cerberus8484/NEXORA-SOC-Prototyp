'use strict';

const { randomUUID } = require('crypto');
const crypto = require('crypto');

// Bekannte externe Quellen — neue Quellen hier registrieren
const KNOWN_SOURCES = ['qradar', 'splunk', 'wazuh', 'email', 'servicenow', 'otrs', 'soar', 'generic'];

const EVENT_STATUSES = ['received', 'normalized', 'ticket_created', 'rejected', 'duplicate'];

class IntegrationEvent {
  constructor({
    id              = randomUUID(),
    source          = '',             // z.B. 'qradar', 'splunk'
    sourceEventId   = '',             // ID des Events im externen System
    rawPayload      = null,           // Originale Rohdaten (unverändert)
    rawPayloadHash  = '',             // SHA256 — für Deduplication
    normalizedData  = null,           // Normalisiertes IntegrationEvent-Format
    status          = 'received',
    rejectionReason = null,
    ip              = '',
    receivedAt      = new Date().toISOString(),
    processedAt     = null,
  } = {}) {
    this.id             = id;
    this.source         = source;
    this.sourceEventId  = sourceEventId;
    this.rawPayload     = rawPayload;
    this.rawPayloadHash = rawPayloadHash || IntegrationEvent.hashPayload(rawPayload);
    this.normalizedData = normalizedData;
    this.status         = status;
    this.rejectionReason = rejectionReason;
    this.ip             = ip;
    this.receivedAt     = receivedAt;
    this.processedAt    = processedAt;
  }

  static hashPayload(payload) {
    if (!payload) return '';
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  // Deduplication-Key — verhindert doppelte Event-Verarbeitung
  get deduplicationKey() {
    return `${this.source}::${this.sourceEventId || this.rawPayloadHash}`;
  }

  static create(data) {
    return new IntegrationEvent({
      ...data,
      id:        randomUUID(),
      receivedAt: new Date().toISOString(),
    });
  }

  toJSON() { return { ...this }; }
}

module.exports = { IntegrationEvent, KNOWN_SOURCES, EVENT_STATUSES };
