'use strict';

const { AnalysisTemplate } = require('../domain/AnalysisTemplate');

class InMemoryAnalysisTemplateRepository {
  constructor() { this._templates = new Map(); }

  async save(template) {
    const t = template instanceof AnalysisTemplate ? template : new AnalysisTemplate(template);
    t.updatedAt = new Date().toISOString();
    this._templates.set(t.id, t);
    return t;
  }

  async findById(id) { return this._templates.get(id) || null; }

  async findByName(name) {
    for (const t of this._templates.values()) if (t.name === name) return t;
    return null;
  }

  async findAll({ limit = 1000, offset = 0 } = {}) {
    return [...this._templates.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + limit);
  }

  async delete(id) { return this._templates.delete(id); }

  async count() { return this._templates.size; }
}

module.exports = { InMemoryAnalysisTemplateRepository };
