'use strict';

const { AnalysisTemplate } = require('../domain/AnalysisTemplate');
const { ValidationError, ConflictError, NotFoundError } = require('../errors/AppError');

/**
 * AnalysisTemplateService — CRUD für geteilte Analyse-Vorlagen.
 *
 * Vorlagen sind über alle Analysten geteilt (Enterprise) und füllen beim
 * Anlegen eines Tickets die Textfelder (Beschreibung/IOCs/Logs/Maßnahmen/…) vor.
 * Eindeutiger Name pro Bibliothek (verhindert Duplikate beim Pflegen).
 */
class AnalysisTemplateService {
  constructor({ repo }) {
    this._repo = repo;
  }

  async create({ name, desc, iocs, logs, actions, rec, notes, author }) {
    if (!name || !String(name).trim()) {
      throw new ValidationError('name ist Pflicht');
    }
    const existing = await this._repo.findByName(String(name).trim());
    if (existing) throw new ConflictError(`Vorlage '${name}' existiert bereits`);
    const template = new AnalysisTemplate({ name, desc, iocs, logs, actions, rec, notes, author });
    return this._repo.save(template);
  }

  async update(id, patch) {
    const template = await this._repo.findById(id);
    if (!template) throw new NotFoundError('Vorlage');
    if (patch.name && String(patch.name).trim() !== template.name) {
      const dup = await this._repo.findByName(String(patch.name).trim());
      if (dup) throw new ConflictError(`Vorlage '${patch.name}' existiert bereits`);
    }
    Object.assign(template, {
      name:    patch.name    != null ? String(patch.name).trim() : template.name,
      desc:    patch.desc    ?? template.desc,
      iocs:    patch.iocs    ?? template.iocs,
      logs:    patch.logs    ?? template.logs,
      actions: patch.actions ?? template.actions,
      rec:     patch.rec     ?? template.rec,
      notes:   patch.notes   ?? template.notes,
    });
    return this._repo.save(template);
  }

  async get(id) {
    const template = await this._repo.findById(id);
    if (!template) throw new NotFoundError('Vorlage');
    return template;
  }

  async list() {
    return this._repo.findAll();
  }

  async remove(id) {
    const deleted = await this._repo.delete(id);
    if (!deleted) throw new NotFoundError('Vorlage');
  }
}

module.exports = { AnalysisTemplateService };
