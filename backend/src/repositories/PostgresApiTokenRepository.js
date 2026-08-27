'use strict';

const { query }    = require('../db/pool');
const { ApiToken } = require('../domain/ApiToken');

/**
 * PostgresApiTokenRepository — produktiver Pfad bei DB_ENABLED=true.
 *
 * Sicherheits-Invariante: token_hash wird in DB gespeichert aber niemals
 * an den Client weitergegeben (toJSON() filtert ihn heraus).
 */
class PostgresApiTokenRepository {
  async save(token) {
    await query(
      `INSERT INTO api_tokens
         (id, user_id, name, token_hash, prefix, last_used_at, expires_at, revoked, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
         SET revoked      = EXCLUDED.revoked,
             last_used_at = EXCLUDED.last_used_at`,
      [
        token.id,
        token.userId,
        token.name,
        token.tokenHash,
        token.prefix,
        token.lastUsedAt,
        token.expiresAt,
        token.revoked,
        token.createdAt,
      ],
    );
    return token;
  }

  async findById(id) {
    const res = await query(
      'SELECT * FROM api_tokens WHERE id = $1',
      [id],
    );
    return res.rows[0] ? ApiToken.fromRow(res.rows[0]) : null;
  }

  /** Sucht aktives (nicht revoked) Token per SHA-256-Hash. */
  async findByHash(hash) {
    const res = await query(
      'SELECT * FROM api_tokens WHERE token_hash = $1 AND NOT revoked',
      [hash],
    );
    return res.rows[0] ? ApiToken.fromRow(res.rows[0]) : null;
  }

  async listByUser(userId, { limit = 500 } = {}) {
    // Gedeckelt — kein unbegrenztes Result-Set (Audit DB-M6). 500 reicht weit über
    // jede realistische PAT-Anzahl je Nutzer; Default abwärtskompatibel.
    const cap = Math.min(Math.max(1, Number(limit) || 500), 1000);
    const res = await query(
      'SELECT * FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, cap],
    );
    return res.rows.map(ApiToken.fromRow);
  }

  async revoke(id) {
    const res = await query(
      'UPDATE api_tokens SET revoked = true WHERE id = $1 RETURNING *',
      [id],
    );
    return res.rows[0] ? ApiToken.fromRow(res.rows[0]) : null;
  }

  async updateLastUsed(id) {
    await query(
      'UPDATE api_tokens SET last_used_at = now() WHERE id = $1',
      [id],
    );
  }
}

module.exports = { PostgresApiTokenRepository };
