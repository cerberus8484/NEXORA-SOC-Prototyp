'use strict';

const { UseCase } = require('../domain/UseCase');
const { ValidationError, ConflictError, NotFoundError } = require('../errors/AppError');

/**
 * UseCaseService — CRUD für die geteilte Use-Case-Bibliothek.
 * Eindeutiger Wert (verhindert Duplikate); kein Update — ein Use-Case ist nur ein Label.
 */
class UseCaseService {
  constructor({ repo }) {
    this._repo = repo;
  }

  async create({ value, author }) {
    if (!value || !String(value).trim()) {
      throw new ValidationError('value ist Pflicht');
    }
    const trimmed = String(value).trim();
    const existing = await this._repo.findByValue(trimmed);
    if (existing) throw new ConflictError(`Use-Case '${trimmed}' existiert bereits`);
    return this._repo.save(new UseCase({ value: trimmed, author }));
  }

  async list() {
    return this._repo.findAll();
  }

  async remove(id) {
    const deleted = await this._repo.delete(id);
    if (!deleted) throw new NotFoundError('Use-Case');
  }
}

module.exports = { UseCaseService };
