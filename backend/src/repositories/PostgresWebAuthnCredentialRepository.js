'use strict';

const { query }              = require('../db/pool');
const { WebAuthnCredential } = require('../domain/WebAuthnCredential');

/**
 * PostgresWebAuthnCredentialRepository — produktiver Pfad bei DB_ENABLED=true.
 * Gleicher öffentlicher Vertrag wie die InMemory-Variante.
 */
class PostgresWebAuthnCredentialRepository {
  /** Mappt eine DB-Zeile (snake_case) auf das Domänenobjekt. */
  _toWebAuthnCredential(row) {
    const transports = typeof row.transports === 'string'
      ? JSON.parse(row.transports || '[]')
      : (row.transports || []);
    const toIso = (v) => (v ? new Date(v).toISOString() : null);
    return new WebAuthnCredential({
      id:           row.id,
      userId:       row.user_id,
      credentialId: row.credential_id,
      publicKey:    row.public_key,
      counter:      Number(row.counter) || 0,
      transports,
      deviceType:   row.device_type ?? null,
      backedUp:     row.backed_up === true,
      label:        row.label ?? '',
      createdAt:    toIso(row.created_at),
      lastUsedAt:   toIso(row.last_used_at),
    });
  }

  async create(credential) {
    await query(
      `INSERT INTO webauthn_credentials
         (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
      [
        credential.id,
        credential.userId,
        credential.credentialId,
        credential.publicKey,
        credential.counter,
        JSON.stringify(credential.transports || []),
        credential.deviceType,
        credential.backedUp,
        credential.label,
        credential.createdAt,
        credential.lastUsedAt,
      ],
    );
    return credential;
  }

  async findByUserId(userId) {
    const res = await query(
      'SELECT * FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at ASC',
      [userId],
    );
    return (res.rows || []).map((r) => this._toWebAuthnCredential(r));
  }

  async findByCredentialId(credentialId) {
    const res = await query(
      'SELECT * FROM webauthn_credentials WHERE credential_id = $1',
      [credentialId],
    );
    return res.rows?.[0] ? this._toWebAuthnCredential(res.rows[0]) : null;
  }

  async updateCounter(credentialId, counter) {
    const res = await query(
      `UPDATE webauthn_credentials
         SET counter = $2, last_used_at = now()
       WHERE credential_id = $1
       RETURNING *`,
      [credentialId, counter],
    );
    return res.rows?.[0] ? this._toWebAuthnCredential(res.rows[0]) : null;
  }

  async deleteById(id, userId) {
    const res = await query(
      'DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}

module.exports = { PostgresWebAuthnCredentialRepository };
