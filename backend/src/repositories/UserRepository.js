'use strict';

/**
 * UserRepository — Interface.
 * Implementierungen: InMemoryUserRepository (Tests/Dev), PostgresUserRepository (Prod).
 */
class UserRepository {
  // eslint-disable-next-line no-unused-vars
  async save(user)        { this._ni('save'); }
  // eslint-disable-next-line no-unused-vars
  async findById(id)      { this._ni('findById'); }
  // eslint-disable-next-line no-unused-vars
  async findByEmail(email) { this._ni('findByEmail'); }
  async findAll()          { this._ni('findAll'); }

  /**
   * Findet einen User über seine externe OIDC-Identität.
   * @param {string} provider — IdP-issuer
   * @param {string} sub — stabiler IdP-Subject-Identifier
   * @returns {Promise<User|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async findByOidcIdentity(provider, sub) { this._ni('findByOidcIdentity'); }

  /**
   * Self-Service-Profilupdate — setzt NUR displayName, phone, theme.
   * role, email, isActive, passwordHash sind hier absichtlich nicht änderbar.
   * @param {string} id
   * @param {{ displayName?: string, phone?: string, theme?: string }} fields
   * @returns {Promise<User|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async updateProfile(id, fields) { this._ni('updateProfile'); }

  _ni(m) { throw new Error(`UserRepository.${m}() ist nicht implementiert`); }
}

module.exports = { UserRepository };
