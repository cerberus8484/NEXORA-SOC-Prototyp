'use strict';

const { UserRepository } = require('./UserRepository');

/**
 * InMemoryUserRepository — Tests + Dev ohne DB.
 * Speichert die vollständige User-Instanz (inkl. passwordHash) — niemals nach außen.
 */
class InMemoryUserRepository extends UserRepository {
  constructor() {
    super();
    this._byId = new Map(); // id → User
  }

  async save(user) {
    this._byId.set(user.id, user);
    return user;
  }

  async findById(id) {
    return this._byId.get(id) || null;
  }

  async findByEmail(email) {
    const target = (email || '').toLowerCase().trim();
    return [...this._byId.values()].find((u) => u.email === target) || null;
  }

  /**
   * Findet einen User über seine externe OIDC-Identität (provider, sub).
   * Leere/null Parameter matchen NIE — sonst würden ungelinkte User
   * (oidcSub=null) versehentlich getroffen.
   */
  async findByOidcIdentity(provider, sub) {
    if (!provider || !sub) return null;
    return [...this._byId.values()].find(
      (u) => u.oidcProvider === provider && u.oidcSub === sub,
    ) || null;
  }

  async findAll({ limit = 1000, offset = 0 } = {}) {
    return [...this._byId.values()].slice(offset, offset + limit);
  }

  /**
   * Self-Service: setzt NUR displayName, phone, theme, language, dateFormat.
   * Alle anderen Felder (role, email, isActive, passwordHash) bleiben unverändert.
   */
  async updateProfile(id, { displayName, phone, theme, language, dateFormat } = {}) {
    const user = this._byId.get(id);
    if (!user) return null;

    if (displayName !== undefined) user.displayName = displayName;
    if (phone       !== undefined) user.phone       = phone;
    if (theme       !== undefined) user.theme       = theme;
    if (language    !== undefined) user.language    = language;
    if (dateFormat  !== undefined) user.dateFormat  = dateFormat;
    user.updatedAt = new Date().toISOString();

    this._byId.set(id, user);
    return user;
  }

  // Test-Hilfsmethoden
  clear() { this._byId.clear(); }
  size()  { return this._byId.size; }
}

module.exports = { InMemoryUserRepository };
