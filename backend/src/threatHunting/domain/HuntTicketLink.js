'use strict';

const { randomUUID } = require('crypto');

/**
 * Quelle eines Hunt→Ticket-Links.
 *   finding  — ein HuntFinding wurde ans Ticket gehängt
 *   artifact — ein HuntArtifact wurde als Evidence ans Ticket gehängt
 *   summary  — die gesamte Hunt-Session-Zusammenfassung wurde ans Ticket geschrieben
 */
const LINK_SOURCE_TYPE = Object.freeze({
  FINDING:  'finding',
  ARTIFACT: 'artifact',
  SUMMARY:  'summary',
});

/**
 * HuntTicketLink — nachvollziehbare Verknüpfung zwischen einem
 * Hunt-Ergebnis und einem SOC-Ticket.
 *
 * Kein Boolean-Flag: jeder Link speichert WER, WANN, WAS, WOHER.
 * Das ist die Traceability-Brücke zwischen ThreatHunting und Ticket-System.
 */
class HuntTicketLink {
  /**
   * @param {object} props
   * @param {string} props.id
   * @param {string} props.huntSessionId
   * @param {string} props.ticketId
   * @param {string} props.sourceType   — LINK_SOURCE_TYPE
   * @param {string} props.sourceId     — Finding/Artifact-ID oder Session-ID (bei summary)
   * @param {string} props.summary      — kurze Beschreibung des verlinkten Inhalts
   * @param {string} props.linkedBy     — Analyst, der verlinkt hat
   * @param {Date}   props.linkedAt
   */
  constructor(props) {
    this.id            = props.id;
    this.huntSessionId = props.huntSessionId;
    this.ticketId      = props.ticketId;
    this.sourceType    = props.sourceType;
    this.sourceId      = props.sourceId;
    this.summary       = props.summary || '';
    this.linkedBy      = props.linkedBy;
    this.linkedAt      = props.linkedAt instanceof Date ? props.linkedAt : new Date(props.linkedAt);
  }

  static create({ huntSessionId, ticketId, sourceType, sourceId, summary = '', linkedBy }) {
    if (!huntSessionId?.trim()) throw new Error('HuntTicketLink: huntSessionId ist Pflichtfeld');
    if (!ticketId?.trim())      throw new Error('HuntTicketLink: ticketId ist Pflichtfeld');
    if (!sourceId?.trim())      throw new Error('HuntTicketLink: sourceId ist Pflichtfeld');
    if (!linkedBy?.trim())      throw new Error('HuntTicketLink: linkedBy ist Pflichtfeld');

    const validTypes = Object.values(LINK_SOURCE_TYPE);
    if (!validTypes.includes(sourceType)) {
      throw new Error(`HuntTicketLink: Ungültiger sourceType "${sourceType}". Erlaubt: ${validTypes.join(', ')}`);
    }

    return new HuntTicketLink({
      id:            randomUUID(),
      huntSessionId: huntSessionId.trim(),
      ticketId:      ticketId.trim(),
      sourceType,
      sourceId:      sourceId.trim(),
      summary:       summary.trim(),
      linkedBy:      linkedBy.trim(),
      linkedAt:      new Date(),
    });
  }

  static fromPersistence(raw) {
    return new HuntTicketLink(raw);
  }

  /**
   * Dedup-Key zur Idempotenz: derselbe Inhalt darf nur einmal
   * an dasselbe Ticket gehängt werden.
   */
  get deduplicationKey() {
    return `${this.huntSessionId}:${this.sourceType}:${this.sourceId}:${this.ticketId}`;
  }

  toJSON() {
    return {
      id:               this.id,
      huntSessionId:    this.huntSessionId,
      ticketId:         this.ticketId,
      sourceType:       this.sourceType,
      sourceId:         this.sourceId,
      summary:          this.summary,
      linkedBy:         this.linkedBy,
      linkedAt:         this.linkedAt.toISOString(),
      deduplicationKey: this.deduplicationKey,
    };
  }
}

module.exports = { HuntTicketLink, LINK_SOURCE_TYPE };
