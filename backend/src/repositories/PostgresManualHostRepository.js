'use strict';

// PostgresManualHostRepository — persistente Manual-Hosts (Nicht-Wazuh-Quelle).
// Spiegelt den Vertrag der InMemory-Variante (findAll / findById / save / delete).
// ip_addresses ist ein TEXT[]; der pg-Treiber mappt JS-Array ↔ text[]. Keine Secrets.

const { ManualHostRepository } = require('./ManualHostRepository');
const { ManualHost } = require('../domain/ManualHost');
const { query } = require('../db/pool');

function iso(v) { return v instanceof Date ? v.toISOString() : v; }

class PostgresManualHostRepository extends ManualHostRepository {
  constructor({ queryFn = query } = {}) {
    super();
    this._query = queryFn;
  }

  _row(r) {
    if (!r) return null;
    return new ManualHost({
      id:          r.id,
      hostname:    r.hostname,
      ipAddresses: Array.isArray(r.ip_addresses) ? r.ip_addresses : [],
      os:          r.os || '',
      customer:    r.customer || '',
      notes:       r.notes || '',
      source:      r.source || 'manual',
      createdBy:   r.created_by,
      createdAt:   iso(r.created_at),
      updatedAt:   iso(r.updated_at),
    }).toJSON();
  }

  async findAll() {
    const r = await this._query('SELECT * FROM manual_hosts ORDER BY created_at, hostname');
    return r.rows.map((row) => this._row(row));
  }

  async findById(id) {
    const r = await this._query('SELECT * FROM manual_hosts WHERE id = $1', [id]);
    return this._row(r.rows[0]);
  }

  async save(host) {
    const r = await this._query(
      `INSERT INTO manual_hosts
         (id, hostname, ip_addresses, os, customer, notes, source, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         hostname     = EXCLUDED.hostname,
         ip_addresses = EXCLUDED.ip_addresses,
         os           = EXCLUDED.os,
         customer     = EXCLUDED.customer,
         notes        = EXCLUDED.notes,
         updated_at   = EXCLUDED.updated_at
       RETURNING *`,
      [
        host.id, host.hostname, host.ipAddresses || [], host.os || '', host.customer || '',
        host.notes || '', host.source || 'manual', host.createdBy ?? null, host.createdAt, host.updatedAt,
      ]);
    return this._row(r.rows[0]);
  }

  async delete(id) {
    const r = await this._query('DELETE FROM manual_hosts WHERE id = $1 RETURNING id', [id]);
    return r.rowCount > 0;
  }
}

module.exports = { PostgresManualHostRepository };
