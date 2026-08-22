'use strict';

/**
 * InMemoryWebAuthnCredentialRepository — Test-/Dev-Speicher für FIDO2-Credentials.
 * Gleicher öffentlicher Vertrag wie die Postgres-Variante.
 */
class InMemoryWebAuthnCredentialRepository {
  constructor() {
    this._byId = new Map();           // id -> credential
  }

  async create(credential) {
    const existing = await this.findByCredentialId(credential.credentialId);
    if (existing) {
      throw new Error(`WebAuthn-Credential bereits vorhanden: ${credential.credentialId}`);
    }
    this._byId.set(credential.id, credential);
    return credential;
  }

  async findByUserId(userId) {
    return [...this._byId.values()].filter((c) => c.userId === userId);
  }

  async findByCredentialId(credentialId) {
    return [...this._byId.values()].find((c) => c.credentialId === credentialId) || null;
  }

  /** Setzt counter (Clone-Erkennung erfolgt im Service) + lastUsedAt. */
  async updateCounter(credentialId, counter) {
    const cred = await this.findByCredentialId(credentialId);
    if (!cred) return null;
    cred.counter    = counter;
    cred.lastUsedAt = new Date().toISOString();
    return cred;
  }

  /** Ownership-scoped: löscht nur, wenn das Credential dem userId gehört. */
  async deleteById(id, userId) {
    const cred = this._byId.get(id);
    if (!cred || cred.userId !== userId) return false;
    this._byId.delete(id);
    return true;
  }
}

module.exports = { InMemoryWebAuthnCredentialRepository };
