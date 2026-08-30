'use strict';

const { randomBytes, createHash } = require('crypto');
const { randomUUID }              = require('crypto');

// Sicherheits-Invarianten:
//   - Token-Wert NIEMALS in DB/Log/Response speichern — nur SHA-256-Hash
//   - Token dem User EINMAL anzeigen (create()), danach nie wieder
//   - toJSON() gibt NIEMALS tokenHash aus

const TOKEN_PREFIX    = 'soc_';
const TOKEN_HEX_LEN   = 64;           // 32 random bytes als hex
const TOKEN_TOTAL_LEN = 4 + TOKEN_HEX_LEN; // soc_ (4) + 64 = 68
const PREFIX_DISPLAY  = 12;           // erste 12 Zeichen für Anzeige
const NAME_MAX_LEN    = 100;

class ApiToken {
  constructor({
    id          = randomUUID(),
    userId,
    name,
    tokenHash,
    prefix,
    lastUsedAt  = null,
    expiresAt   = null,
    revoked     = false,
    createdAt   = new Date().toISOString(),
  } = {}) {
    this.id          = id;
    this.userId      = userId;
    this.name        = name;
    this.tokenHash   = tokenHash;   // SHA-256-Hash — niemals nach außen
    this.prefix      = prefix;
    this.lastUsedAt  = lastUsedAt;
    this.expiresAt   = expiresAt;
    this.revoked     = revoked;
    this.createdAt   = createdAt;
  }

  // ── Erstellung ──────────────────────────────────────────────────────────────
  // Gibt { token (plain, EINMALIG), domain } zurück.
  // Der Klartext-Token wird nach dieser Funktion nie wieder rekonstruierbar sein.
  static async create({ userId, name, expiresAt = null } = {}) {
    if (!userId) throw new Error('userId ist erforderlich');
    if (!name)   throw new Error('name ist erforderlich');
    if (typeof name === 'string' && name.length > NAME_MAX_LEN) {
      throw new Error(`name darf maximal ${NAME_MAX_LEN} Zeichen haben`);
    }

    const hexPart  = randomBytes(32).toString('hex'); // 64 hex chars
    const token    = TOKEN_PREFIX + hexPart;          // soc_ + 64 = 68 chars
    const hash     = createHash('sha256').update(token).digest('hex');
    const prefix   = token.slice(0, PREFIX_DISPLAY) + '...'; // erste 12 + ...

    const domain = new ApiToken({
      userId,
      name,
      tokenHash: hash,
      prefix,
      expiresAt: expiresAt || null,
    });

    return { token, domain };
  }

  // ── Rekonstruktion aus DB-Row ────────────────────────────────────────────────
  static fromRow(row) {
    return new ApiToken({
      id:         row.id,
      userId:     row.user_id,
      name:       row.name,
      tokenHash:  row.token_hash,
      prefix:     row.prefix,
      lastUsedAt: row.last_used_at || null,
      expiresAt:  row.expires_at   || null,
      revoked:    row.revoked,
      createdAt:  row.created_at,
    });
  }

  // ── Zustand ──────────────────────────────────────────────────────────────────
  get isExpired() {
    if (!this.expiresAt) return false;
    return new Date(this.expiresAt) < new Date();
  }

  get isActive() {
    return !this.revoked && !this.isExpired;
  }

  // ── Serialisierung — SICHERHEIT: tokenHash wird NICHT ausgegeben ─────────────
  toJSON() {
    return {
      id:         this.id,
      userId:     this.userId,
      name:       this.name,
      prefix:     this.prefix,
      lastUsedAt: this.lastUsedAt,
      expiresAt:  this.expiresAt,
      revoked:    this.revoked,
      createdAt:  this.createdAt,
    };
  }
}

module.exports = { ApiToken, TOKEN_PREFIX, TOKEN_TOTAL_LEN };
