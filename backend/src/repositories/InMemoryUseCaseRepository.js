'use strict';

const { UseCase } = require('../domain/UseCase');

class InMemoryUseCaseRepository {
  constructor() { this._items = new Map(); }

  async save(useCase) {
    const uc = useCase instanceof UseCase ? useCase : new UseCase(useCase);
    uc.updatedAt = new Date().toISOString();
    this._items.set(uc.id, uc);
    return uc;
  }

  async findById(id) { return this._items.get(id) || null; }

  async findByValue(value) {
    for (const uc of this._items.values()) if (uc.value === value) return uc;
    return null;
  }

  async findAll({ limit = 1000, offset = 0 } = {}) {
    return [...this._items.values()].sort((a, b) => a.value.localeCompare(b.value)).slice(offset, offset + limit);
  }

  async delete(id) { return this._items.delete(id); }

  async count() { return this._items.size; }
}

module.exports = { InMemoryUseCaseRepository };
