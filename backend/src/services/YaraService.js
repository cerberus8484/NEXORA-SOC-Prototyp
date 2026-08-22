'use strict';

const { YaraRule, isDangerousRegex } = require('../domain/YaraRule');

/** Lehnt Regex-Patterns mit ReDoS-Risiko ab (wirft 400). */
function assertSafePatterns(patterns) {
  for (const p of patterns || []) {
    if (p?.type === 'regex' && isDangerousRegex(p.value)) {
      throw Object.assign(
        new Error(`Regex-Pattern abgelehnt — ReDoS-Risiko (verschachtelte Quantoren / zu lang): ${p.value}`),
        { status: 400 }
      );
    }
  }
}

/**
 * YaraService — CRUD für YARA-Regeln + Scan-Engine.
 *
 * scan(input, opts) prüft einen String gegen alle aktiven Regeln und gibt
 * gefundene Matches mit Regel-Metadaten zurück.
 */
class YaraService {
  constructor({ repo }) {
    this._repo = repo;
  }

  /** Erstellt eine neue Regel. Wirft bei Duplikat-Name. */
  async createRule({ name, description, tags, patterns, condition, author, severity, mitreAttack }) {
    if (!name || !patterns?.length) throw Object.assign(new Error('name und patterns sind Pflicht'), { status: 400 });
    assertSafePatterns(patterns);
    const existing = await this._repo.findByName(name);
    if (existing) throw Object.assign(new Error(`Regelname '${name}' bereits vergeben`), { status: 409 });
    const rule = new YaraRule({ name, description, tags, patterns, condition, author, severity, mitreAttack });
    return this._repo.save(rule);
  }

  /** Aktualisiert eine bestehende Regel. */
  async updateRule(id, patch) {
    const rule = await this._repo.findById(id);
    if (!rule) throw Object.assign(new Error('Regel nicht gefunden'), { status: 404 });
    if (patch.patterns) assertSafePatterns(patch.patterns);
    if (patch.name && patch.name !== rule.name) {
      const dup = await this._repo.findByName(patch.name);
      if (dup) throw Object.assign(new Error(`Regelname '${patch.name}' bereits vergeben`), { status: 409 });
    }
    Object.assign(rule, {
      name:        patch.name        ?? rule.name,
      description: patch.description ?? rule.description,
      tags:        patch.tags        ?? rule.tags,
      patterns:    patch.patterns    ?? rule.patterns,
      condition:   patch.condition   ?? rule.condition,
      enabled:     patch.enabled     ?? rule.enabled,
      author:      patch.author      ?? rule.author,
      severity:    patch.severity    ?? rule.severity,
      mitreAttack: patch.mitreAttack ?? rule.mitreAttack,
    });
    return this._repo.save(rule);
  }

  async getRule(id) {
    const rule = await this._repo.findById(id);
    if (!rule) throw Object.assign(new Error('Regel nicht gefunden'), { status: 404 });
    return rule;
  }

  async listRules({ enabledOnly = false, tag } = {}) {
    return this._repo.findAll({ enabledOnly, tag });
  }

  async deleteRule(id) {
    const deleted = await this._repo.delete(id);
    if (!deleted) throw Object.assign(new Error('Regel nicht gefunden'), { status: 404 });
  }

  /**
   * Scannt einen Input-String gegen alle aktiven Regeln.
   * Gibt { matches: [{ruleId, name, severity, mitreAttack, hits}], scannedRules } zurück.
   */
  async scan(input, { tag } = {}) {
    if (!input) return { matches: [], scannedRules: 0 };
    const rules = await this._repo.findAll({ enabledOnly: true, tag });
    const matches = [];
    for (const rule of rules) {
      const { matched, hits } = rule.match(input);
      if (matched) matches.push({ ruleId: rule.id, name: rule.name, severity: rule.severity, mitreAttack: rule.mitreAttack, hits });
    }
    return { matches, scannedRules: rules.length };
  }
}

module.exports = { YaraService };
