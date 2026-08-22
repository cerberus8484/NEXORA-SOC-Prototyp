'use strict';

const { YaraRule } = require('../domain/YaraRule');

class InMemoryYaraRepository {
  constructor() { this._rules = new Map(); }

  async save(rule) {
    const r = rule instanceof YaraRule ? rule : new YaraRule(rule);
    r.updatedAt = new Date().toISOString();
    this._rules.set(r.id, r);
    return r;
  }

  async findById(id) { return this._rules.get(id) || null; }

  async findByName(name) {
    for (const r of this._rules.values()) if (r.name === name) return r;
    return null;
  }

  async findAll({ enabledOnly = false, tag, limit = 1000, offset = 0 } = {}) {
    let rules = [...this._rules.values()];
    if (enabledOnly) rules = rules.filter((r) => r.enabled);
    if (tag) rules = rules.filter((r) => r.tags.includes(tag));
    return rules.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + limit);
  }

  async delete(id) { return this._rules.delete(id); }

  async count() { return this._rules.size; }
}

module.exports = { InMemoryYaraRepository };
