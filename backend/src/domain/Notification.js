'use strict';

const { randomUUID } = require('crypto');

// Severity-Werte: dieselben wie Ticket-PRIORITIES für Konsistenz (critical → info)
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// Quellen einer Notification — erweiterbar (Adapter-Prinzip)
const SOURCES = ['ticket', 'agent', 'system', 'hunt', 'integration'];

class Notification {
  constructor({
    id        = randomUUID(),
    userId    = '',
    severity  = 'info',
    title     = '',
    body      = '',
    source    = 'system',
    link      = '',
    read      = false,
    createdAt = new Date().toISOString(),
  } = {}) {
    this.id        = id;
    this.userId    = userId;
    this.severity  = severity;
    this.title     = title;
    this.body      = body;
    this.source    = source;
    this.link      = link;
    this.read      = Boolean(read);
    this.createdAt = createdAt;
  }

  /**
   * Factory — Validierung beim Erstellen.
   * Wirft bei ungültigen Pflichtfeldern oder Enum-Verstößen.
   */
  static create(data = {}) {
    if (!data.userId || typeof data.userId !== 'string' || !data.userId.trim()) {
      throw new Error('Notification.create: userId ist Pflicht');
    }
    if (!data.title || typeof data.title !== 'string' || !data.title.trim()) {
      throw new Error('Notification.create: title ist Pflicht');
    }
    if (data.severity !== undefined && !SEVERITIES.includes(data.severity)) {
      throw new Error(`Notification.create: severity muss einer von [${SEVERITIES.join(', ')}] sein — erhalten: ${data.severity}`);
    }
    if (data.source !== undefined && !SOURCES.includes(data.source)) {
      throw new Error(`Notification.create: source muss einer von [${SOURCES.join(', ')}] sein — erhalten: ${data.source}`);
    }
    return new Notification(data);
  }

  toJSON() {
    return {
      id:        this.id,
      userId:    this.userId,
      severity:  this.severity,
      title:     this.title,
      body:      this.body,
      source:    this.source,
      link:      this.link,
      read:      this.read,
      createdAt: this.createdAt,
    };
  }
}

module.exports = { Notification, SEVERITIES, SOURCES };
