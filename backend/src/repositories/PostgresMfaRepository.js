'use strict';

const { query }         = require('../db/pool');
const { MfaEnrollment } = require('../domain/MfaEnrollment');

/**
 * PostgresMfaRepository — produktiver Pfad bei DB_ENABLED=true.
 *
 * Eine MFA-Anmeldung pro User (user_id UNIQUE). secret_enc + Recovery-Hashes
 * werden in der DB gespeichert, aber durch toJSON() nie an den Client gegeben.
 */
class PostgresMfaRepository {
  async save(enrollment) {
    await query(
      `INSERT INTO mfa_enrollments
         (id, user_id, status, secret_enc, recovery_codes, created_at, activated_at, disabled_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE
         SET status         = EXCLUDED.status,
             secret_enc     = EXCLUDED.secret_enc,
             recovery_codes = EXCLUDED.recovery_codes,
             activated_at   = EXCLUDED.activated_at,
             disabled_at    = EXCLUDED.disabled_at`,
      [
        enrollment.id,
        enrollment.userId,
        enrollment.status,
        enrollment.secretEnc,
        JSON.stringify(enrollment.recoveryCodes || []),
        enrollment.createdAt,
        enrollment.activatedAt,
        enrollment.disabledAt,
      ],
    );
    return enrollment;
  }

  async findByUser(userId) {
    const res = await query(
      'SELECT * FROM mfa_enrollments WHERE user_id = $1',
      [userId],
    );
    return res.rows[0] ? MfaEnrollment.fromRow(res.rows[0]) : null;
  }

  async deleteByUser(userId) {
    await query('DELETE FROM mfa_enrollments WHERE user_id = $1', [userId]);
  }
}

module.exports = { PostgresMfaRepository };
