'use strict';

const { randomUUID } = require('crypto');

const SEVERITIES  = ['critical', 'high', 'medium', 'low', 'info'];
const CONDITIONS  = ['all', 'any'];
const PATTERN_TYPES = ['text', 'hex', 'regex'];

// ── ReDoS-Schutz ────────────────────────────────────────────
// Input wird gekappt (catastrophic backtracking skaliert mit Eingabelänge),
// und Regex mit verschachtelten Quantoren werden abgelehnt/übersprungen.
const MAX_INPUT_LEN   = 100_000;   // 100 KB Scan-Haystack
const MAX_PATTERN_LEN = 2_000;

/**
 * Erkennt die ausbeutbare ReDoS-Klasse: verschachtelte Quantoren wie
 * (a+)+, (a*)*, (.*)+ — also eine Gruppe mit innerem Quantor, gefolgt von
 * einem äußeren Quantor. Heuristik, kein vollständiger Linear-Time-Engine,
 * blockiert aber die klassischen catastrophic-backtracking-Muster.
 */
function isDangerousRegex(src) {
  if (typeof src !== 'string') return false;
  if (src.length > MAX_PATTERN_LEN) return true;
  // Gruppe, die einen Quantor enthält, direkt gefolgt von einem äußeren Quantor.
  return /\([^)]*[+*]\)[+*]|\([^)]*[+*][^)]*\)\s*\{|\([^)]*\{\d+,?\d*\}[^)]*\)[+*]/.test(src);
}

/**
 * YaraRule — JS-basierte Pattern-Matching-Regel (kein nativer YARA-Daemon).
 *
 * Jede Regel hat:
 *   - patterns: [{id, type, value, modifiers}]  (text/hex/regex)
 *   - condition: 'all' | 'any' | { threshold: N }
 *
 * match(input) prüft einen String gegen alle Patterns und wertet die Condition aus.
 */
class YaraRule {
  constructor({ id, name, description = '', tags = [], patterns = [], condition = 'any',
    enabled = true, author = '', severity = 'medium', mitreAttack = '',
    createdAt, updatedAt } = {}) {
    this.id          = id || randomUUID();
    this.name        = String(name || '').trim();
    this.description = String(description || '').trim();
    this.tags        = Array.isArray(tags) ? tags.map(String) : [];
    this.patterns    = Array.isArray(patterns) ? patterns : [];
    this.condition   = condition;
    this.enabled     = Boolean(enabled);
    this.author      = String(author || '').trim();
    this.severity    = SEVERITIES.includes(severity) ? severity : 'medium';
    this.mitreAttack = String(mitreAttack || '').trim();
    this.createdAt   = createdAt || new Date().toISOString();
    this.updatedAt   = updatedAt || new Date().toISOString();
  }

  /** Gibt true zurück wenn mindestens ein Pattern vorhanden und name gesetzt. */
  isValid() {
    return Boolean(this.name) && this.patterns.length > 0;
  }

  /**
   * Prüft einen Input-String gegen alle Patterns.
   * Gibt { matched: bool, hits: [{patternId, value}] } zurück.
   */
  match(input) {
    if (!this.enabled || !input) return { matched: false, hits: [] };
    // Input kappen — bounded Worst-Case bei Backtracking.
    const str = String(input).slice(0, MAX_INPUT_LEN);
    const hits = [];

    for (const p of this.patterns) {
      if (_matchPattern(p, str)) hits.push({ patternId: p.id, value: p.value });
    }

    const matched = _evalCondition(this.condition, hits.length, this.patterns.length);
    return { matched, hits };
  }

  toJSON() {
    return {
      id: this.id, name: this.name, description: this.description,
      tags: this.tags, patterns: this.patterns, condition: this.condition,
      enabled: this.enabled, author: this.author, severity: this.severity,
      mitreAttack: this.mitreAttack, createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }
}

/** Prüft einen einzelnen String gegen ein Pattern-Objekt. */
function _matchPattern(p, str) {
  const mods = Array.isArray(p.modifiers) ? p.modifiers : [];
  const nocase = mods.includes('nocase');

  try {
    if (p.type === 'regex') {
      // ReDoS-Schutz: gefährliche Muster nie ausführen.
      if (isDangerousRegex(p.value)) return false;
      const flags = nocase ? 'i' : '';
      return new RegExp(p.value, flags).test(str);
    }
    if (p.type === 'hex') {
      // Hex-Pattern: "4D 5A" → binäres Muster im String suchen
      const hexStr = p.value.replace(/\s+/g, '').toLowerCase();
      const target = nocase ? str.toLowerCase() : str;
      // Als Byte-Sequenz in UTF-8-kodiertem String — best-effort
      return target.includes(Buffer.from(hexStr, 'hex').toString('latin1'));
    }
    // text (default)
    const needle = nocase ? p.value.toLowerCase() : p.value;
    const haystack = nocase ? str.toLowerCase() : str;
    return haystack.includes(needle);
  } catch {
    return false;
  }
}

/** Wertet die Condition aus: 'all', 'any', oder { threshold: N }. */
function _evalCondition(condition, hitCount, totalPatterns) {
  if (condition === 'all') return hitCount === totalPatterns && totalPatterns > 0;
  if (condition === 'any') return hitCount > 0;
  if (condition && typeof condition === 'object' && condition.threshold != null) {
    return hitCount >= Number(condition.threshold);
  }
  return hitCount > 0;
}

module.exports = { YaraRule, SEVERITIES, CONDITIONS, PATTERN_TYPES, isDangerousRegex };
