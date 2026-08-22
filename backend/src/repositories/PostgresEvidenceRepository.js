'use strict';

const { query }    = require('../db/pool');
const { Evidence } = require('../domain/Evidence');

function fromRow(r) {
  if (!r) return null;
  return new Evidence({
    id: r.id, ticketId: r.ticket_id || '', payloadId: r.payload_id ?? null,
    type: r.type, source: r.source, title: r.title || '',
    logSource: r.log_source || '', eventId: r.event_id || '', query: r.query || '', rawText: r.raw_text || '',
    eventTimestamp: r.event_timestamp?.toISOString?.() || r.event_timestamp || null,
    confidence: r.confidence ?? null, comment: r.comment || '', collectedBy: r.collected_by || '',
    collectedAt: r.collected_at?.toISOString?.() || r.collected_at,
    createdAt: r.created_at?.toISOString?.() || r.created_at,
    sha256: r.sha256 || '',  // gespeicherten Hash erhalten (nicht neu berechnen → Manipulationserkennung)
  }).toJSON();
}

class PostgresEvidenceRepository {
  constructor({ queryFn = query } = {}) {
    this._query = queryFn;
  }

  async create(data) {
    const e = data instanceof Evidence ? data : Evidence.create(data);
    await this._query(`
      INSERT INTO evidence
        (id, ticket_id, payload_id, type, source, title, log_source, event_id, query, raw_text,
         event_timestamp, confidence, comment, collected_by, collected_at, created_at, sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    `, [e.id, e.ticketId || '', e.payloadId ?? null, e.type, e.source, e.title, e.logSource, e.eventId,
        e.query, e.rawText, e.eventTimestamp || null, e.confidence ?? null, e.comment, e.collectedBy, e.collectedAt, e.createdAt, e.sha256]);
    return this.findById(e.id);
  }

  async findById(id) {
    const r = await this._query('SELECT * FROM evidence WHERE id=$1', [id]);
    return fromRow(r.rows[0]);
  }

  async findByTicket(ticketId) {
    const r = await this._query('SELECT * FROM evidence WHERE ticket_id=$1 ORDER BY created_at DESC', [ticketId]);
    return r.rows.map(fromRow);
  }

  async findAll({ limit = 200 } = {}) {
    const r = await this._query('SELECT * FROM evidence ORDER BY created_at DESC LIMIT $1', [limit]);
    return r.rows.map(fromRow);
  }
}

module.exports = { PostgresEvidenceRepository };
