'use strict';

// PostgresDataplaneStatusRepository — gleicher Vertrag wie InMemory.
// Ein Snapshot je node_id (upsert über ON CONFLICT). JSONB für die genesteten
// Betriebszähler (collectors/intake/outbox), die nicht einzeln abgefragt werden.

const { query } = require('../db/pool');

function iso(v) { return v instanceof Date ? v.toISOString() : v; }

class PostgresDataplaneStatusRepository {
  constructor({ queryFn = query } = {}) { this._query = queryFn; }

  _row(r) {
    if (!r) return null;
    return {
      nodeId: r.node_id,
      reportedAt: iso(r.reported_at),
      receivedAt: iso(r.received_at),
      collectors: r.collectors || [],
      intake: r.intake || {},
      outbox: r.outbox || {},
      updatedAt: iso(r.updated_at),
    };
  }

  async get(nodeId) {
    const r = await this._query('SELECT * FROM dataplane_status WHERE node_id = $1', [nodeId]);
    return this._row(r.rows[0]);
  }

  async list() {
    const r = await this._query('SELECT * FROM dataplane_status ORDER BY node_id');
    return r.rows.map((row) => this._row(row));
  }

  async upsert(nodeId, snapshot = {}) {
    const collectors = JSON.stringify(Array.isArray(snapshot.collectors) ? snapshot.collectors : []);
    const intake = JSON.stringify(snapshot.intake || {});
    const outbox = JSON.stringify(snapshot.outbox || {});
    const r = await this._query(
      `INSERT INTO dataplane_status
         (node_id, reported_at, received_at, collectors, intake, outbox, updated_at)
       VALUES ($1,$2,now(),$3::jsonb,$4::jsonb,$5::jsonb,now())
       ON CONFLICT (node_id) DO UPDATE SET
         reported_at = $2,
         received_at = now(),
         collectors  = $3::jsonb,
         intake      = $4::jsonb,
         outbox      = $5::jsonb,
         updated_at  = now()
       RETURNING *`,
      [nodeId, snapshot.reportedAt ?? null, collectors, intake, outbox]);
    return this._row(r.rows[0]);
  }
}

module.exports = { PostgresDataplaneStatusRepository };
