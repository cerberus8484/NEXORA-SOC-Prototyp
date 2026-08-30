'use strict';

const { UserRepository } = require('./UserRepository');
const { User }           = require('../domain/User');
const { query }          = require('../db/pool');

/**
 * PostgresUserRepository — persistente Benutzerverwaltung.
 * Gibt vollständige User-Instanzen zurück (inkl. passwordHash für Login-Prüfung);
 * die Maskierung passiert erst in User.toPublicJSON() an der API-Grenze.
 */
class PostgresUserRepository extends UserRepository {

  _toIso(v) {
    if (!v) return null;
    return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
  }

  _rowToUser(row) {
    if (!row) return null;
    return new User({
      id:           row.id,
      email:        row.email,
      displayName:  row.display_name,
      passwordHash: row.password_hash,
      role:         row.role,
      isActive:     row.is_active,
      lastLoginAt:  this._toIso(row.last_login_at),
      createdAt:    this._toIso(row.created_at),
      updatedAt:    this._toIso(row.updated_at),
      phone:        row.phone       ?? '',
      theme:        row.theme       ?? '',
      language:     row.language     ?? 'de',
      dateFormat:   row.date_format  ?? 'dmy',
      passwordChangedAt: this._toIso(row.password_changed_at),
      passwordHistory:   Array.isArray(row.password_history) ? row.password_history : [],
      mustChangePassword: row.must_change_password === true,
      oidcSub:           row.oidc_sub      ?? null,
      oidcProvider:      row.oidc_provider ?? null,
    });
  }

  async save(user) {
    await query(`
      INSERT INTO users
        (id, email, display_name, password_hash, role, is_active, last_login_at, created_at, updated_at, phone, theme, language, date_format, password_changed_at, password_history, oidc_sub, oidc_provider, must_change_password)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO UPDATE SET
        email               = EXCLUDED.email,
        display_name        = EXCLUDED.display_name,
        password_hash       = EXCLUDED.password_hash,
        role                = EXCLUDED.role,
        is_active           = EXCLUDED.is_active,
        last_login_at       = EXCLUDED.last_login_at,
        updated_at          = NOW(),
        phone               = EXCLUDED.phone,
        theme               = EXCLUDED.theme,
        language            = EXCLUDED.language,
        date_format         = EXCLUDED.date_format,
        password_changed_at = EXCLUDED.password_changed_at,
        password_history    = EXCLUDED.password_history,
        oidc_sub            = EXCLUDED.oidc_sub,
        oidc_provider       = EXCLUDED.oidc_provider,
        must_change_password = EXCLUDED.must_change_password
    `, [
      user.id, user.email, user.displayName, user.passwordHash, user.role,
      user.isActive, user.lastLoginAt || null, user.createdAt, user.updatedAt,
      user.phone || '', user.theme || '', user.language || 'de', user.dateFormat || 'dmy',
      user.passwordChangedAt || null, JSON.stringify(user.passwordHistory || []),
      user.oidcSub || null, user.oidcProvider || null, user.mustChangePassword === true,
    ]);
    return this.findById(user.id);
  }

  /**
   * Self-Service: setzt NUR displayName, phone, theme, language, dateFormat via gezieltes UPDATE.
   * role/email/isActive/passwordHash sind absichtlich nicht änderbar über diesen Pfad.
   */
  async updateProfile(id, { displayName, phone, theme, language, dateFormat } = {}) {
    const sets   = [];
    const values = [];
    let   idx    = 1;

    if (displayName !== undefined) { sets.push(`display_name = $${idx++}`); values.push(displayName); }
    if (phone       !== undefined) { sets.push(`phone = $${idx++}`);        values.push(phone); }
    if (theme       !== undefined) { sets.push(`theme = $${idx++}`);        values.push(theme); }
    if (language    !== undefined) { sets.push(`language = $${idx++}`);     values.push(language); }
    if (dateFormat  !== undefined) { sets.push(`date_format = $${idx++}`);  values.push(dateFormat); }

    if (sets.length === 0) return this.findById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const res = await query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return this._rowToUser(res.rows[0] ?? null);
  }

  async findById(id) {
    const res = await query('SELECT * FROM users WHERE id = $1', [id]);
    return this._rowToUser(res.rows[0]);
  }

  async findByEmail(email) {
    const res = await query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase().trim()]);
    return this._rowToUser(res.rows[0]);
  }

  /**
   * Findet einen User über seine externe OIDC-Identität (provider, sub).
   * Leere Parameter matchen nie (kein versehentlicher Treffer auf ungelinkte User).
   */
  async findByOidcIdentity(provider, sub) {
    if (!provider || !sub) return null;
    const res = await query(
      'SELECT * FROM users WHERE oidc_provider = $1 AND oidc_sub = $2',
      [provider, sub],
    );
    return this._rowToUser(res.rows[0]);
  }

  async findAll({ limit = 1000, offset = 0 } = {}) {
    const res = await query('SELECT * FROM users ORDER BY email ASC LIMIT $1 OFFSET $2', [limit, offset]);
    return res.rows.map((row) => this._rowToUser(row));
  }
}

module.exports = { PostgresUserRepository };
