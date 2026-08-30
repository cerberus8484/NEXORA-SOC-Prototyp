'use strict';

/**
 * InMemoryAutonomyPolicyRepository
 *
 * In-Memory-Implementierung für Tests/Dev (DB_ENABLED=false).
 * Gleicher Vertrag wie PostgresAutonomyPolicyRepository.
 *
 * Unique-Constraint: (customer, actionClass) — analog zum SQL-Index
 * idx_autonomy_policies_scope (Migration 027).
 */

const { AutonomyPolicy } = require('../domain/AutonomyPolicy');

class InMemoryAutonomyPolicyRepository {
  constructor() {
    this._byId    = new Map(); // id → AutonomyPolicy Instanz
    this._scopeIndex = new Map(); // `${customer}::${actionClass}` → id
  }

  // ─── Interner Scope-Key ───────────────────────────────────────────────────

  _scopeKey(customer, actionClass) {
    return `${customer}::${actionClass}`;
  }

  // ─── create ───────────────────────────────────────────────────────────────

  async create(data) {
    const policy = data instanceof AutonomyPolicy
      ? data
      : AutonomyPolicy.create(data);

    const key = this._scopeKey(policy.customer, policy.actionClass);
    if (this._scopeIndex.has(key)) {
      throw Object.assign(
        new Error(
          `Unique-Constraint verletzt: Policy für customer='${policy.customer}' ` +
          `und actionClass='${policy.actionClass}' existiert bereits.`
        ),
        { status: 409, code: 'UNIQUE_SCOPE_VIOLATION' }
      );
    }

    this._byId.set(policy.id, policy);
    this._scopeIndex.set(key, policy.id);
    return policy.toJSON();
  }

  // ─── findById ─────────────────────────────────────────────────────────────

  async findById(id) {
    const policy = this._byId.get(id);
    return policy ? policy.toJSON() : null;
  }

  // ─── findAll ({limit, offset}) → { data, total } ─────────────────────────

  async findAll({ limit = 50, offset = 0 } = {}) {
    const all = [...this._byId.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // neueste zuerst
    return {
      data:  all.slice(offset, offset + limit).map((p) => p.toJSON()),
      total: all.length,
    };
  }

  // ─── update ───────────────────────────────────────────────────────────────

  async update(id, patch) {
    const policy = this._byId.get(id);
    if (!policy) return null;

    const updated = policy.update(patch); // immutable update — gibt neue Instanz
    this._byId.set(id, updated);
    // Scope-Key ändert sich nicht (customer/actionClass sind unveränderlich)
    return updated.toJSON();
  }

  // ─── delete ───────────────────────────────────────────────────────────────

  async delete(id) {
    const policy = this._byId.get(id);
    if (!policy) return; // idempotent — kein Fehler bei unbekannter ID
    const key = this._scopeKey(policy.customer, policy.actionClass);
    this._scopeIndex.delete(key);
    this._byId.delete(id);
  }

  // ─── findByCustomerAndClass ───────────────────────────────────────────────

  async findByCustomerAndClass(customer, actionClass) {
    const key = this._scopeKey(customer, actionClass);
    const id  = this._scopeIndex.get(key);
    if (!id) return null;
    const policy = this._byId.get(id);
    return policy ? policy.toJSON() : null;
  }

  // ─── Hilfsmethode für Tests ───────────────────────────────────────────────

  size() {
    return this._byId.size;
  }
}

module.exports = { InMemoryAutonomyPolicyRepository };
