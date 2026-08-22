'use strict';

const { randomUUID } = require('crypto');

const LOG_LEVEL = Object.freeze({
  INFO:    'info',
  WARNING: 'warning',
  ERROR:   'error',
  SUCCESS: 'success',
});

/**
 * HuntLog — eine Zeile der Hunt-Console (Backend-Ausgabe des Runners).
 *
 * seq sichert die chronologische Reihenfolge auch bei identischem Timestamp
 * (synchroner Runner erzeugt mehrere Logs in derselben Millisekunde).
 */
class HuntLog {
  constructor(props) {
    this.id        = props.id;
    this.sessionId = props.sessionId;
    this.seq       = Number.isFinite(props.seq) ? props.seq : 0;
    this.level     = Object.values(LOG_LEVEL).includes(props.level) ? props.level : LOG_LEVEL.INFO;
    this.message   = String(props.message || '');
    this.timestamp = props.timestamp instanceof Date ? props.timestamp : new Date(props.timestamp);
  }

  static create({ sessionId, level = LOG_LEVEL.INFO, message, seq = 0, timestamp = null }) {
    if (!sessionId) throw new Error('HuntLog: sessionId ist Pflichtfeld');
    return new HuntLog({
      id:        randomUUID(),
      sessionId,
      seq,
      level,
      message:   String(message || ''),
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });
  }

  static fromPersistence(raw) {
    return new HuntLog(raw);
  }

  toJSON() {
    return {
      id:        this.id,
      sessionId: this.sessionId,
      seq:       this.seq,
      level:     this.level,
      message:   this.message,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

module.exports = { HuntLog, LOG_LEVEL };
