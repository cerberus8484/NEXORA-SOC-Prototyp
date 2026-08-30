'use strict';

// PostgresExternalLinkRepository — restart-fester Beleg für Outbound-Exporte (#3a).
// Spiegelt den Vertrag der InMemory-Variante (save / findByDeduplicationKey /
// findByTicketId). Dedup-Anker ist der UNIQUE-Index (external_system, external_id)
// == ExternalLink.deduplicationKey → ON CONFLICT macht save idempotent, sodass ein
// Re-Export desselben Tickets nach Neustart KEINEN Duplikat-Eintrag erzeugt.

const { ExternalLinkRepository } = require('./ExternalLinkRepository');
const { ExternalLink } = require('../domain/ExternalLink');
const { query } = require('../db/pool');

function iso(v) { return v instanceof Date ? v.toISOString() : v; }

class PostgresExternalLinkRepository extends ExternalLinkRepository {
  constructor({ queryFn = query } = {}) {
    super();
    this._query = queryFn;
  }

  _row(r) {
    if (!r) return null;
    return new ExternalLink({
      id:               r.id,
      internalTicketId: r.internal_ticket_id,
      externalSystem:   r.external_system,
      externalId:       r.external_id,
      externalUrl:      r.external_url || '',
      syncDirection:    r.sync_direction,
      syncStatus:       r.sync_status,
      lastSyncAt:       iso(r.last_sync_at),
      lastSyncError:    r.last_sync_error,
      rawPayloadHash:   r.raw_payload_hash || '',
      createdAt:        iso(r.created_at),
      updatedAt:        iso(r.updated_at),
    });
  }

  async save(link) {
    const r = await this._query(
      `INSERT INTO external_links
         (id, internal_ticket_id, external_system, external_id, external_url,
          sync_direction, sync_status, last_sync_at, last_sync_error,
          raw_payload_hash, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (external_system, external_id) DO UPDATE SET
         internal_ticket_id = EXCLUDED.internal_ticket_id,
         external_url       = EXCLUDED.external_url,
         sync_direction     = EXCLUDED.sync_direction,
         sync_status        = EXCLUDED.sync_status,
         last_sync_at       = EXCLUDED.last_sync_at,
         last_sync_error    = EXCLUDED.last_sync_error,
         raw_payload_hash   = EXCLUDED.raw_payload_hash,
         updated_at         = EXCLUDED.updated_at
       RETURNING *`,
      [
        link.id, link.internalTicketId, link.externalSystem, link.externalId,
        link.externalUrl || '', link.syncDirection, link.syncStatus,
        link.lastSyncAt ?? null, link.lastSyncError ?? null,
        link.rawPayloadHash || '', link.createdAt, link.updatedAt,
      ]);
    return this._row(r.rows[0]);
  }

  async findByDeduplicationKey(key) {
    // deduplicationKey == `${externalSystem}::${externalId}`. Erstes '::' trennt;
    // externalId selbst darf keine '::'-Semantik tragen, hier defensiv gesplittet.
    const idx = String(key).indexOf('::');
    if (idx < 0) return null;
    const externalSystem = key.slice(0, idx);
    const externalId     = key.slice(idx + 2);
    const r = await this._query(
      'SELECT * FROM external_links WHERE external_system = $1 AND external_id = $2',
      [externalSystem, externalId]);
    return this._row(r.rows[0]);
  }

  async findByTicketId(ticketId) {
    const r = await this._query(
      'SELECT * FROM external_links WHERE internal_ticket_id = $1 ORDER BY created_at',
      [ticketId]);
    return r.rows.map((row) => this._row(row));
  }
}

module.exports = { PostgresExternalLinkRepository };
