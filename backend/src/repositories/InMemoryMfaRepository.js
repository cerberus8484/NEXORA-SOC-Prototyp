'use strict';

/**
 * InMemoryMfaRepository — Tests + Dev ohne DB.
 *
 * Eine MFA-Anmeldung pro User (Index per userId). secretEnc + Recovery-Hashes
 * werden intern gehalten, aber durch toJSON() des Domain-Objekts nie ausgegeben.
 */
class InMemoryMfaRepository {
  constructor() {
    this._byUser = new Map(); // userId → MfaEnrollment
  }

  async save(enrollment) {
    this._byUser.set(enrollment.userId, enrollment);
    return enrollment;
  }

  async findByUser(userId) {
    return this._byUser.get(userId) || null;
  }

  async deleteByUser(userId) {
    this._byUser.delete(userId);
  }

  // Test-Hilfen
  clear() { this._byUser.clear(); }
  size()  { return this._byUser.size; }
}

module.exports = { InMemoryMfaRepository };
