'use strict';

const { randomUUID } = require('crypto');

// Chain-of-Custody-Event zu einem Evidence-Item (append-only Protokoll).
const CUSTODY_ACTIONS = ['viewed', 'reviewed', 'verified', 'flagged', 'note', 'exported'];

class CustodyEvent {
  constructor({ id = randomUUID(), evidenceId = '', action = 'note', actor = '', note = '', createdAt = new Date().toISOString() } = {}) {
    this.id         = id;
    this.evidenceId = evidenceId;
    this.action     = CUSTODY_ACTIONS.includes(action) ? action : 'note';
    this.actor      = actor;
    this.note       = note;
    this.createdAt  = createdAt;
  }

  static create(d) { return new CustodyEvent({ ...d, id: randomUUID(), createdAt: new Date().toISOString() }); }
  toJSON() { return { ...this }; }
}

// Abgeleiteter Review-Status aus der Event-Historie.
function deriveReviewStatus(events = []) {
  if (events.some((e) => e.action === 'verified')) return 'verified';
  if (events.some((e) => e.action === 'reviewed')) return 'reviewed';
  if (events.some((e) => e.action === 'flagged'))  return 'flagged';
  return 'open';
}

module.exports = { CustodyEvent, CUSTODY_ACTIONS, deriveReviewStatus };
