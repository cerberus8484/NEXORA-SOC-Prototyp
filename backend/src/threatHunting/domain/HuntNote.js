'use strict';

const { randomUUID } = require('crypto');

/**
 * HuntNote — freie Analyst-Notiz innerhalb einer ThreatHuntSession.
 *
 * Kein Status, kein Lifecycle — nur Freitext + Metadaten.
 * Dient als Tagebuch / Thought-Log des Analysten.
 */
class HuntNote {
  /**
   * @param {object} props
   * @param {string} props.id
   * @param {string} props.sessionId   — ThreatHuntSession.id
   * @param {string} props.content     — Notiz-Inhalt (Freitext)
   * @param {string} props.analystId
   * @param {Date}   props.createdAt
   */
  constructor(props) {
    this.id        = props.id;
    this.sessionId = props.sessionId;
    this.content   = props.content;
    this.analystId = props.analystId;
    this.createdAt = props.createdAt instanceof Date ? props.createdAt : new Date(props.createdAt);
  }

  static create({ sessionId, content, analystId }) {
    if (!sessionId?.trim()) throw new Error('HuntNote: sessionId ist Pflichtfeld');
    if (!content?.trim())   throw new Error('HuntNote: content ist Pflichtfeld');
    if (!analystId?.trim()) throw new Error('HuntNote: analystId ist Pflichtfeld');

    return new HuntNote({
      id:        randomUUID(),
      sessionId: sessionId.trim(),
      content:   content.trim(),
      analystId: analystId.trim(),
      createdAt: new Date(),
    });
  }

  static fromPersistence(raw) {
    return new HuntNote(raw);
  }

  toJSON() {
    return {
      id:        this.id,
      sessionId: this.sessionId,
      content:   this.content,
      analystId: this.analystId,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

module.exports = { HuntNote };
