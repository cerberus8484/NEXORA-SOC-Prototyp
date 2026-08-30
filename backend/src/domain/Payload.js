'use strict';

const { randomUUID } = require('crypto');

const PAYLOAD_TYPES = [
  'URL','Domain','IP','File','Script','Command','Email',
  'Registry-Key','User-Agent','Hash','Encoded String','Andere',
];

class Payload {
  constructor({
    id        = randomUUID(),
    ticketId  = '',
    type      = '',
    raw       = '',
    rawHash   = '',          // SHA256 des raw-Wertes für Deduplication
    fields    = {},          // Typ-spezifische Felder (URL, IP, Hash etc.)
    decoded   = '',          // Base64/Hex-Decoded Inhalt falls vorhanden
    parserNotes = '',        // Hinweise des Smart Parsers (Warnungen, Kontext)
    confidence  = null,      // 0-100 — spätere KI-Bewertung
    createdAt = new Date().toISOString(),
  } = {}) {
    this.id           = id;
    this.ticketId     = ticketId;
    this.type         = type;
    this.raw          = raw;
    this.rawHash      = rawHash;
    this.fields       = fields;
    this.decoded      = decoded;
    this.parserNotes  = parserNotes;
    this.confidence   = confidence;
    this.createdAt    = createdAt;
  }

  static create(data) {
    return new Payload({
      ...data,
      id:        randomUUID(),
      createdAt: new Date().toISOString(),
    });
  }

  toJSON() {
    return { ...this };
  }
}

module.exports = { Payload, PAYLOAD_TYPES };
