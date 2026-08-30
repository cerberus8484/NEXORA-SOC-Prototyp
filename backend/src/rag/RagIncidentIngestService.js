'use strict';

/**
 * RagIncidentIngestService — speist abgeschlossene Tickets und genehmigte
 * KI-Analysen als knappe Wissens-Dokumente in die Qdrant-Collection "incidents".
 *
 * DSGVO-Minimierungsentscheidung (Art. 5 Abs. 1 lit. c DSGVO — Datensparsamkeit):
 *   Tickets enthalten PII (IPs, Hostnamen, Usernamen, E-Mails, Hashes).
 *   Im Wissens-Dokument werden KEINE Klartextwerte gespeichert:
 *   – IPs, E-Mails, Hashes, Domains, URLs werden zu Typ-Platzhaltern (<ipv4>, <email> …).
 *   – Hostnamen und Nutzernamen werden vollständig weggelassen.
 *   – MITRE-Techniken, Verdict, Severity, IOC-Typen und die übertragbare
 *     Lehre/das Muster (Resolution) werden gespeichert — kein direkter Personenbezug.
 *   Begründung: Für semantische Suche ("Welche vergangenen Fälle ähneln diesem?")
 *   braucht die Wissensbasis das MUSTER, nicht die konkreten PII-Werte.
 *
 * Idempotenz: Stable-UUID aus SHA-256("incident:<source>:<id>") — zweimal derselbe
 * Fall erzeugt einen Upsert, kein Duplikat.
 *
 * Abhängigkeiten werden injiziert — kein Hard-Coupling an Qdrant/Ollama-Instanzen.
 * In Tests durch Fakes ersetzbar.
 */

const crypto = require('crypto');
const logger  = require('../logger');

// DSGVO: Typen-Muster die in Freitexten ersetzt werden.
// Als Source-Strings gehalten, NICHT als geteilte RegExp-Objekte — pro Aufruf
// wird eine frische Instanz erzeugt (kein /g-lastIndex-State zwischen Aufrufen).
// URL-Quantor begrenzt (\S{1,2000}) als ReDoS-/DoS-Schutz auf Freitext.
const IOC_REDACT_PATTERNS = [
  ['url',    String.raw`\bhttps?:\/\/\S{1,2000}`],
  ['email',  String.raw`\b[^\s@]+@[^\s@]+\.[^\s@]+\b`],
  ['ipv4',   String.raw`\b(?:\d{1,3}\.){3}\d{1,3}\b`],
  ['hash',   String.raw`\b[a-f0-9]{32,64}\b`],
  ['domain', String.raw`\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b`],
];

const COLLECTION_INCIDENTS = 'incidents';

// Wie RagIngestionService.stableId — eigene Kopie damit kein Zirkel-Import
function _stableId(key) {
  const h = crypto.createHash('sha256').update(String(key)).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

/**
 * Bereinigt Freitext von direkten PII-Werten und ersetzt diese durch Typ-Tags.
 * Gibt { text, iocTypes } zurück.
 *
 * @param {string} raw
 * @returns {{ text: string, iocTypes: string[] }}
 */
function redactPii(raw) {
  if (!raw || typeof raw !== 'string') return { text: '', iocTypes: [] };
  const found = new Set();
  let out = raw;
  for (const [type, src] of IOC_REDACT_PATTERNS) {
    const re = new RegExp(src, 'gi'); // frische Instanz pro Aufruf → kein State
    const replaced = out.replace(re, `<${type}>`);
    if (replaced !== out) { found.add(type); out = replaced; }
  }
  return { text: out, iocTypes: [...found] };
}

/**
 * Baut ein datensparames Wissens-Dokument aus einem abgeschlossenen Ticket.
 * Kein Hostname, kein Klartext-IP/Email — nur das Muster.
 *
 * @param {object} ticket  — Ticket-Objekt oder Plain-Object mit ticket-Feldern
 * @returns {{ key: string, text: string, payload: object }}
 */
function buildDocFromTicket(ticket) {
  if (!ticket || !ticket.id) {
    throw Object.assign(new Error('buildDocFromTicket: ticket.id fehlt'), { status: 400 });
  }

  const { text: titleClean, iocTypes: titleIoc }    = redactPii(ticket.title);
  const { text: descClean,  iocTypes: descIoc }     = redactPii(ticket.description);
  const { text: resClean,   iocTypes: resIoc }      = redactPii(ticket.recommendation || ticket.actions || '');

  const iocTypes = [...new Set([...titleIoc, ...descIoc, ...resIoc])];
  const mitre    = String(ticket.mitre || '').trim();
  const severity = ticket.priority || ticket.severity || '';
  // closeReason ist i.d.R. ein Enum (false_positive…), kann aber bei externen
  // Importen Freitext mit PII tragen → ebenso redigieren. incidentRef (z.B.
  // QRadar-Ref) kann ebenfalls PII enthalten → redigieren statt blind übernehmen.
  const closeReason = redactPii(ticket.closeReason || '').text;
  const incidentRef = redactPii(
    ticket.ticketNr || ticket.ticketNumber || `INC-${String(ticket.id).slice(0,8)}`,
  ).text;

  // Lehre/Muster: was wurde getan + Empfehlung (beide bereinigt)
  const resolution = [descClean.slice(0, 800), resClean.slice(0, 400)]
    .filter(Boolean).join('\n---\n');

  const text = [
    `Incident: ${incidentRef} | Severity: ${severity} | CloseReason: ${closeReason}`,
    `Title: ${titleClean}`,
    `MITRE: ${mitre || 'unknown'}`,
    `IOC-Typen: ${iocTypes.join(', ') || 'keine'}`,
    `Muster/Lehre:\n${resolution}`,
  ].join('\n');

  return {
    key: `incident:ticket:${ticket.id}`,
    text,
    payload: {
      source:       'ticket',
      incidentRef,
      severity,
      closeReason,
      mitre,
      iocTypes,
      // DSGVO: Freitext nur anonymisiert — kein Klartext-PII
      titleAnon:      titleClean,
      resolutionAnon: resolution.slice(0, 1200),
    },
  };
}

/**
 * Baut ein datensparames Wissens-Dokument aus einer genehmigten AgentSuggestion.
 * Das analysis-Objekt (verdict, mitreAttack, iocs, assessment) wird strukturiert
 * in den Wissensspeicher aufgenommen — PII aus assessment/iocs wird bereinigt.
 *
 * @param {object} suggestion  — AgentSuggestion-Objekt oder Plain-Object
 * @returns {{ key: string, text: string, payload: object }}
 */
function buildDocFromSuggestion(suggestion) {
  if (!suggestion || !suggestion.id) {
    throw Object.assign(new Error('buildDocFromSuggestion: suggestion.id fehlt'), { status: 400 });
  }
  if (suggestion.status !== 'approved') {
    throw Object.assign(
      new Error(`buildDocFromSuggestion: nur genehmigte Suggestions (status=approved), got '${suggestion.status}'`),
      { status: 400 }
    );
  }

  const analysis = suggestion.analysis || {};

  // DSGVO: assessment und iocs (Freitext) bereinigen — MITRE-IDs sind keine PII
  const { text: assessAnon, iocTypes: assessIoc } = redactPii(
    String(analysis.assessment || suggestion.rationale || '')
  );
  // iocs kann ein Array oder String sein
  const rawIocs = Array.isArray(analysis.iocs)
    ? analysis.iocs.join('\n')
    : String(analysis.iocs || '');
  const { text: iocsAnon, iocTypes: iocsIoc } = redactPii(rawIocs);

  const mitreTechniques = Array.isArray(analysis.mitreAttack)
    ? analysis.mitreAttack.map((t) => String(t.id || t).trim()).filter(Boolean).join(', ')
    : String(analysis.mitreAttack || '').trim();

  const verdict   = String(analysis.verdict || suggestion.verdict || '').trim();
  const severity  = String(analysis.severity || '').trim();
  const iocTypes  = [...new Set([...assessIoc, ...iocsIoc])];
  const ticketRef = suggestion.ticketId ? `ticket:${suggestion.ticketId}` : '';

  const text = [
    `KI-Analyse-Wissen | Suggestion: ${suggestion.id} | Ref: ${ticketRef}`,
    `Verdict: ${verdict} | Severity: ${severity}`,
    `MITRE: ${mitreTechniques || 'unknown'}`,
    `IOC-Typen: ${iocTypes.join(', ') || 'keine'}`,
    `Assessment (anon):\n${assessAnon.slice(0, 800)}`,
    `IOC-Muster (anon):\n${iocsAnon.slice(0, 400)}`,
  ].join('\n');

  return {
    key: `incident:suggestion:${suggestion.id}`,
    text,
    payload: {
      source:          'suggestion',
      suggestionId:    suggestion.id,
      ticketRef,
      verdict,
      severity,
      mitreTechniques,
      iocTypes,
      confidence:      suggestion.confidence || 0,
      // DSGVO: keine Klartextwerte — nur anonymisierte Zusammenfassung
      assessmentAnon:  assessAnon.slice(0, 600),
      iocsAnon:        iocsAnon.slice(0, 300),
    },
  };
}

/**
 * RagIncidentIngestService — Kern-Service.
 *
 * Injiziert: embedder (OllamaEmbedder-API: embed(text)), qdrant (QdrantClient-API).
 * In Tests durch Fakes ersetzbar — keine harte Kopplung an globale Instanzen.
 */
class RagIncidentIngestService {
  /**
   * @param {{ embedder: { embed(text: string): Promise<number[]> }, qdrant: { ensureCollection, upsert } }} deps
   */
  constructor({ embedder, qdrant }) {
    if (!embedder || typeof embedder.embed !== 'function') {
      throw new Error('RagIncidentIngestService: embedder mit embed()-Methode erforderlich');
    }
    if (!qdrant || typeof qdrant.upsert !== 'function') {
      throw new Error('RagIncidentIngestService: qdrant mit upsert()-Methode erforderlich');
    }
    this._embedder = embedder;
    this._qdrant   = qdrant;
  }

  /**
   * Nimmt EIN abgeschlossenes Ticket und speist es als Wissens-Dokument ein.
   * Idempotent — gleiche ticket.id → gleicher Qdrant-Point-UUID → Upsert.
   *
   * @param {object} ticket
   * @returns {Promise<{ ok: boolean, docId: string, collection: string }>}
   */
  async ingestTicket(ticket) {
    const doc = buildDocFromTicket(ticket);
    return this._embed_and_upsert(doc);
  }

  /**
   * Nimmt eine genehmigte AgentSuggestion und speist sie als Wissens-Dokument ein.
   * Nur status='approved' wird akzeptiert (Guard).
   *
   * @param {object} suggestion
   * @returns {Promise<{ ok: boolean, docId: string, collection: string }>}
   */
  async ingestSuggestion(suggestion) {
    const doc = buildDocFromSuggestion(suggestion);
    return this._embed_and_upsert(doc);
  }

  /**
   * Interner Schritt: Embedding erzeugen, Collection sicherstellen, Upsert.
   * Fehler (Qdrant/Embedder down) werden NICHT verschluckt — expliziter Fehler
   * mit context-Feldern zum Logging durch den Aufrufer.
   *
   * @private
   */
  async _embed_and_upsert(doc) {
    let vector;
    try {
      vector = await this._embedder.embed(doc.text);
    } catch (err) {
      logger.error('rag_incident_embed_failed', { key: doc.key, message: err.message });
      throw Object.assign(
        new Error(`RagIncidentIngestService: Embedding fehlgeschlagen — ${err.message}`),
        { status: 502, cause: err }
      );
    }

    const docId = _stableId(doc.key);

    try {
      await this._qdrant.ensureCollection(COLLECTION_INCIDENTS, vector.length);
      await this._qdrant.upsert(COLLECTION_INCIDENTS, [{ id: docId, vector, payload: doc.payload }]);
    } catch (err) {
      logger.error('rag_incident_upsert_failed', { key: doc.key, docId, message: err.message });
      throw Object.assign(
        new Error(`RagIncidentIngestService: Qdrant-Upsert fehlgeschlagen — ${err.message}`),
        { status: 502, cause: err }
      );
    }

    logger.info('rag_incident_ingested', { key: doc.key, docId, collection: COLLECTION_INCIDENTS });
    return { ok: true, docId, collection: COLLECTION_INCIDENTS };
  }
}

module.exports = {
  RagIncidentIngestService,
  buildDocFromTicket,
  buildDocFromSuggestion,
  redactPii,
  COLLECTION_INCIDENTS,
};
