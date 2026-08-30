'use strict';

const { AuditRepository } = require('./AuditRepository');
const { query }           = require('../db/pool');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgresAuditRepository — append-only Audit-Log.
 * Kein UPDATE/DELETE (Policy). actor_user_id ist UUID-FK auf users(id);
 * nicht-UUID-Werte werden auf NULL gemappt, damit Audit nie einen Request bricht.
 */
class PostgresAuditRepository extends AuditRepository {
  /** actor_user_id ist UUID-FK — nicht-UUID-Werte (z.B. 'system') → NULL. */
  _normalizeActorId(actorUserId) {
    return actorUserId && UUID_RE.test(actorUserId) ? actorUserId : null;
  }

  _rowToEntry(r) {
    if (!r) return null;
    return {
      id:          r.id,
      actorUserId: r.actor_user_id,
      actorLabel:  r.actor_label,
      action:      r.action,
      targetType:  r.target_type,
      targetId:    r.target_id,
      metadata:    typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      ip:          r.ip_address,
      createdAt:   r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    };
  }

  async save(entry) {
    const actorUserId = this._normalizeActorId(entry.actorUserId);

    await query(`
      INSERT INTO audit_log
        (id, actor_user_id, actor_label, action, target_type, target_id, metadata, ip_address, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      entry.id,
      actorUserId,
      entry.actorLabel || '',
      entry.action,
      entry.targetType || '',
      String(entry.targetId || ''),
      JSON.stringify(entry.metadata || {}),
      entry.ip || '',
      entry.createdAt,
    ]);
    return entry;
  }

  // Lese-Zugriff: gibt { data, total, limit, offset } zurück.
  // COUNT(*) und SELECT nutzen identische WHERE-Klausel → exaktes total ohne Drift.
  async findRecent({ limit = 100, offset = 0, action, targetType, targetId, search } = {}) {
    const conditions = [];
    const filterParams = [];
    let p = 1;

    if (action)     { conditions.push(`action = $${p++}`);      filterParams.push(action); }
    if (targetType) { conditions.push(`target_type = $${p++}`); filterParams.push(targetType); }
    if (targetId)   { conditions.push(`target_id = $${p++}`);   filterParams.push(String(targetId)); }
    if (search) {
      // A6a: Volltext über erlaubte Felder (Actor/Action/Target) — EIN Platzhalter, mehrfach
      // referenziert; vollständig parametrisiert (kein String-Concat, kein Injection-Vektor).
      const like = `%${String(search).toLowerCase()}%`;
      conditions.push(
        `(LOWER(actor_label) LIKE $${p} OR LOWER(action) LIKE $${p} OR LOWER(target_type) LIKE $${p} OR LOWER(target_id) LIKE $${p})`,
      );
      filterParams.push(like);
      p++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // COUNT mit identischer WHERE-Klausel — Platzhalter $1..$p-1
    const countRes = await query(
      `SELECT COUNT(*) AS total FROM audit_log ${where}`,
      filterParams,
    );
    const total = Number(countRes.rows[0].total);

    // SELECT mit LIMIT $p OFFSET $p+1 — Platzhalter korrekt nachgezählt
    const dataParams = [...filterParams, limit, offset];
    const dataRes = await query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
      dataParams,
    );

    return {
      data:   dataRes.rows.map((r) => this._rowToEntry(r)),
      total,
      limit,
      offset,
    };
  }
}

module.exports = { PostgresAuditRepository };
