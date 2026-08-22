'use strict';

const { query }        = require('../db/pool');
const { CustodyEvent } = require('../domain/CustodyEvent');

function fromRow(r) {
  if (!r) return null;
  return new CustodyEvent({
    id: r.id, evidenceId: r.evidence_id || '', action: r.action, actor: r.actor || '', note: r.note || '',
    createdAt: r.created_at?.toISOString?.() || r.created_at,
  }).toJSON();
}

class PostgresCustodyRepository {
  async create(data) {
    const e = data instanceof CustodyEvent ? data : CustodyEvent.create(data);
    await query(
      'INSERT INTO evidence_custody (id, evidence_id, action, actor, note, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [e.id, e.evidenceId, e.action, e.actor, e.note, e.createdAt],
    );
    return e.toJSON();
  }

  async findByEvidence(evidenceId) {
    const r = await query('SELECT * FROM evidence_custody WHERE evidence_id=$1 ORDER BY created_at ASC', [evidenceId]);
    return r.rows.map(fromRow);
  }

  // Batch: ein DB-Query für alle evidence_ids → kein N+1.
  // Rückgabe: { [evidenceId]: CustodyEvent[] } (aufsteigend nach created_at).
  async findByEvidenceIds(ids) {
    if (!ids || ids.length === 0) return {};
    const r = await query('SELECT * FROM evidence_custody WHERE evidence_id = ANY($1) ORDER BY created_at ASC', [ids]);
    const grouped = {};
    for (const row of r.rows) {
      const ev = fromRow(row);
      (grouped[ev.evidenceId] ||= []).push(ev);
    }
    return grouped;
  }
}

module.exports = { PostgresCustodyRepository };
