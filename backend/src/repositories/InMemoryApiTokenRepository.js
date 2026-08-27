'use strict';

/**
 * InMemoryApiTokenRepository — Tests + Dev ohne DB.
 *
 * Sicherheits-Invariante: tokenHash wird intern gespeichert aber niemals
 * an Service/Route zurückgegeben (toJSON() des Domain-Objekts filtert ihn heraus).
 */
class InMemoryApiTokenRepository {
  constructor() {
    this._byId   = new Map(); // id → ApiToken (mit tokenHash intern)
    this._byHash = new Map(); // tokenHash → id (Lookup-Index)
  }

  async save(token) {
    this._byId.set(token.id, token);
    if (token.tokenHash) {
      this._byHash.set(token.tokenHash, token.id);
    }
    return token;
  }

  async findById(id) {
    return this._byId.get(id) || null;
  }

  /**
   * Sucht aktives (nicht revoked) Token per SHA-256-Hash.
   * Gibt null zurück wenn nicht gefunden oder revoked.
   */
  async findByHash(hash) {
    const id = this._byHash.get(hash);
    if (!id) return null;
    const token = this._byId.get(id);
    if (!token) return null;
    if (token.revoked) return null;
    return token;
  }

  async listByUser(userId) {
    return [...this._byId.values()].filter(t => t.userId === userId);
  }

  async revoke(id) {
    const token = this._byId.get(id);
    if (!token) return null;
    token.revoked = true;
    this._byId.set(id, token);
    return token;
  }

  async updateLastUsed(id) {
    const token = this._byId.get(id);
    if (!token) return;
    token.lastUsedAt = new Date().toISOString();
    this._byId.set(id, token);
  }

  // Test-Hilfsmethode
  clear() {
    this._byId.clear();
    this._byHash.clear();
  }

  size() { return this._byId.size; }
}

module.exports = { InMemoryApiTokenRepository };
