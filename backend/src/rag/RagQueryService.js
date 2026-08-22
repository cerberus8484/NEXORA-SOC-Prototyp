'use strict';

const logger = require('../logger');

const COLLECTIONS = Object.freeze({
  MITRE:     'mitre_attack',
  HUNTS:     'hunt_catalog',
  INCIDENTS: 'past_incidents',
});

// llama3.2:3b hat ein kurzes Kontextfenster — pro Collection nur wenige
// kleine Treffer und ein hartes Gesamt-Längenbudget, damit der RAG-Block den
// eigentlichen Triage-Prompt nicht verdrängt.
const SECTION_TOP_K        = 3;     // Treffer pro Collection (klein halten)
const DESC_MAX_LEN         = 240;   // Beschreibung je Treffer kappen
const CONTEXT_BUDGET_CHARS = 4000;  // Gesamtbudget über alle Abschnitte

class RagQueryService {
  constructor({ embedder, qdrant, enabled = null, topK = null } = {}) {
    this._embedder = embedder;
    this._qdrant   = qdrant;
    this._enabled  = enabled != null ? enabled : process.env.RAG_ENABLED === 'true';
    this._topK     = topK != null ? topK : parseInt(process.env.RAG_TOP_K || '3', 10);
  }

  get enabled() { return this._enabled; }

  async findRelevant(text, collection, topK = this._topK) {
    if (!this._enabled || !text || !String(text).trim()) return [];
    try {
      const vector = await this._embedder.embed(String(text));
      return await this._qdrant.search(collection, vector, topK);
    } catch (err) {
      logger.warn('rag_query_failed', { collection, message: err.message });
      return [];
    }
  }

  /**
   * Baut den RAG-Kontext aus allen drei Wissens-Collections (MITRE ATT&CK,
   * Hunt-Katalog, ähnliche vergangene Incidents) und mergt sie zu einem
   * strukturierten Prompt-Block.
   *
   * Fail-safe: Jede Collection wird einzeln abgefragt; eine leere/fehlende oder
   * fehlerhafte Collection liefert einen leeren Abschnitt (übersprungen) und
   * crasht den Gesamt-Kontext nicht. Ein hartes Gesamt-Längenbudget schützt das
   * kurze Kontextfenster lokaler Modelle.
   *
   * @param {string} summaryText
   * @returns {Promise<string>} Strukturierter Kontext oder '' wenn nichts relevant.
   */
  async buildContext(summaryText) {
    if (!this._enabled) return '';
    const topK = Math.min(this._topK, SECTION_TOP_K);

    // Collections parallel abfragen — findRelevant ist bereits fail-safe (try/catch → []).
    const [mitre, hunts, incidents] = await Promise.all([
      this.findRelevant(summaryText, COLLECTIONS.MITRE, topK),
      this.findRelevant(summaryText, COLLECTIONS.HUNTS, topK),
      this.findRelevant(summaryText, COLLECTIONS.INCIDENTS, topK),
    ]);

    const sections = [
      this._section('=== Wissensbasis (MITRE ATT&CK, semantisch relevant) ===', mitre, formatMitre),
      this._section('=== Eigene Threat-Hunts (semantisch relevant) ===', hunts, formatHunt),
      this._section('=== Ähnliche vergangene Incidents (anonymisiert) ===', incidents, formatIncident),
    ].filter(Boolean);

    if (!sections.length) return '';

    // Gesamt-Längenbudget: Abschnitte in Reihenfolge aufnehmen, solange das
    // Budget reicht. Ein zu langer Abschnitt wird hart abgeschnitten statt
    // verworfen, damit wenigstens der Anfang (Top-Treffer) erhalten bleibt.
    let out = '';
    for (const section of sections) {
      if (out.length >= CONTEXT_BUDGET_CHARS) break;
      const sep       = out ? '\n' : '';
      const remaining = CONTEXT_BUDGET_CHARS - out.length - sep.length;
      out += sep + section.slice(0, remaining);
    }
    return out;
  }

  /** Einen Kontext-Abschnitt bauen; leere Trefferliste → null (übersprungen). */
  _section(heading, hits, formatFn) {
    if (!hits || !hits.length) return null;
    const lines = hits.map((h) => formatFn(h.payload || {}));
    return [heading, ...lines].join('\n');
  }
}

function clampDesc(value) {
  return String(value || '').slice(0, DESC_MAX_LEN);
}

function formatMitre(p) {
  return `  - ${p.techniqueId || p.id || '?'} ${p.name || ''}: ${clampDesc(p.description)}`;
}

function formatHunt(p) {
  const mitre = p.mitre ? ` [${p.mitre}]` : '';
  return `  - ${p.label || p.huntKey || '?'}${mitre}: ${clampDesc(p.description)}`;
}

function formatIncident(p) {
  const mitre = p.mitre ? ` [${p.mitre}]` : '';
  const sev   = p.severity ? ` (${p.severity})` : '';
  return `  - ${p.incidentRef || '?'}${sev}${mitre}: ${clampDesc(p.title)}`;
}

module.exports = { RagQueryService, COLLECTIONS };
