'use strict';

const { randomUUID } = require('crypto');

const MAX_CONTENT_LENGTH = 5000;

/**
 * OffenseNote — Analyst-Freitext-Notiz zu einer QRadar-Offense.
 *
 * Immutables Domain-Objekt. author kommt IMMER aus req.user.sub (Token),
 * niemals aus dem HTTP-Body — dies wird in der Route sichergestellt.
 *
 * DSGVO: Notizinhalt ist Freitext und kann personenbezogene Daten enthalten.
 * Zugriff nur durch authentifizierte Analysten (requireAuth in Route).
 * Kein Logging des content-Feldes.
 */
class OffenseNote {
  /**
   * @param {object} props
   * @param {string} props.id
   * @param {string} props.offenseId
   * @param {string} props.content
   * @param {string} props.author
   * @param {Date}   props.createdAt
   */
  constructor(props) {
    this.id        = props.id;
    this.offenseId = props.offenseId;
    this.content   = props.content;
    this.author    = props.author;
    this.createdAt = props.createdAt instanceof Date ? props.createdAt : new Date(props.createdAt);
  }

  /**
   * Erzeugt eine neue OffenseNote mit Validierung.
   *
   * @param {object} params
   * @param {string} params.offenseId
   * @param {string} params.content
   * @param {string} params.author   — muss aus req.user.sub kommen, nie aus Body
   */
  static create({ offenseId, content, author }) {
    if (!offenseId?.trim()) throw new Error('OffenseNote: offenseId ist Pflichtfeld');
    if (!content?.trim())   throw new Error('OffenseNote: content ist Pflichtfeld');
    if (content.trim().length > MAX_CONTENT_LENGTH) {
      throw new Error(`OffenseNote: content darf maximal ${MAX_CONTENT_LENGTH} Zeichen lang sein`);
    }
    if (!author?.trim()) throw new Error('OffenseNote: author ist Pflichtfeld');

    return new OffenseNote({
      id:        randomUUID(),
      offenseId: offenseId.trim(),
      content:   content.trim(),
      author:    author.trim(),
      createdAt: new Date(),
    });
  }

  static fromPersistence(raw) {
    return new OffenseNote(raw);
  }

  toJSON() {
    return {
      id:        this.id,
      offenseId: this.offenseId,
      content:   this.content,
      author:    this.author,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

module.exports = { OffenseNote };
