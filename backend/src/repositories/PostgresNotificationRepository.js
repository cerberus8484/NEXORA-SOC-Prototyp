'use strict';

const { query } = require('../db/pool');
const { Notification } = require('../domain/Notification');

const DEFAULT_LIMIT = 50;

function fromRow(r) {
  if (!r) return null;
  return new Notification({
    id:        r.id,
    userId:    r.user_id,
    severity:  r.severity,
    title:     r.title,
    body:      r.body      || '',
    source:    r.source    || 'system',
    link:      r.link      || '',
    read:      Boolean(r.read),
    createdAt: r.created_at?.toISOString?.() || r.created_at,
  }).toJSON();
}

/**
 * PostgresNotificationRepository — Produktions-Persistenz.
 * Benötigt Migration 029_notifications.sql.
 */
class PostgresNotificationRepository {
  async create(data) {
    const n = data instanceof Notification ? data : new Notification(data);
    const plain = n.toJSON();
    await query(`
      INSERT INTO notifications (id, user_id, severity, title, body, source, link, read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [plain.id, plain.userId, plain.severity, plain.title, plain.body, plain.source, plain.link, plain.read, plain.createdAt]);
    return plain;
  }

  async listForUser(userId, { unreadOnly = false, limit = DEFAULT_LIMIT } = {}) {
    const conditions = ['user_id = $1'];
    const params     = [userId];
    let   idx        = 2;

    if (unreadOnly) {
      conditions.push(`read = false`);
    }

    const where = conditions.join(' AND ');
    const r = await query(
      `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      [...params, limit]
    );
    return r.rows.map(fromRow);
  }

  async unreadCount(userId) {
    const r = await query(
      'SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = $1 AND read = false',
      [userId]
    );
    return parseInt(r.rows[0]?.cnt || '0', 10);
  }

  async markRead(id, userId) {
    const r = await query(
      'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );
    return r.rows.length > 0 ? fromRow(r.rows[0]) : null;
  }

  async markAllRead(userId) {
    const r = await query(
      'UPDATE notifications SET read = true WHERE user_id = $1 AND read = false',
      [userId]
    );
    return r.rowCount || 0;
  }
}

module.exports = { PostgresNotificationRepository };
