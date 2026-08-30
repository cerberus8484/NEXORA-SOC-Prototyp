'use strict';

const { randomUUID } = require('crypto');

// ─── DSGVO-Hinweis ───────────────────────────────────────────────────────────
// PublishedDetection ist ein SIEM-agnostischer Snapshot der Detection-Logik.
// PFLICHT:
//   - Nur detectionLogic.queryOrRule + explanation übernehmen (technische Felder).
//   - KEINE testCases, description, playbookSteps — diese können rohe PII
//     (IPs, Hostnamen, User-IDs aus Incident-Events) enthalten.
//   - Art. 5 Abs. 1 lit. c DSGVO: Datensparsamkeit.
//   - Art. 32 DSGVO: Technische und organisatorische Maßnahmen (TOM).
// ─────────────────────────────────────────────────────────────────────────────

const VALID_LANGUAGES = ['wazuh', 'sigma', 'splunk', 'qradar', 'generic'];

class PublishedDetection {
  constructor({
    id          = randomUUID(),
    draftId     = '',
    ucNumber    = null,
    title       = '',
    language    = 'generic',
    rule        = '',
    explanation = '',
    mitre       = [],
    severity    = 'medium',
    sourceType  = '',
    sourceId    = '',
    publishedBy = '',
    createdAt   = new Date().toISOString(),
  } = {}) {
    this.id          = id;
    this.draftId     = String(draftId || '');
    this.ucNumber    = ucNumber || null;   // vom Draft übernommene UC-INC-Nummer (Katalog-Referenz)
    this.title       = String(title || '');
    this.language    = VALID_LANGUAGES.includes(language) ? language : 'generic';
    this.rule        = String(rule || '');
    this.explanation = String(explanation || '');
    this.mitre       = Array.isArray(mitre) ? mitre : [];
    this.severity    = String(severity || 'medium');
    this.sourceType  = String(sourceType || '');
    this.sourceId    = String(sourceId || '');
    this.publishedBy = String(publishedBy || '');
    this.createdAt   = createdAt;
  }

  // ─── Factory ──────────────────────────────────────────────────────────────

  /**
   * Erzeugt einen PublishedDetection-Snapshot aus einem UseCaseDraft-DTO.
   *
   * DSGVO: Nimmt AUSSCHLIESSLICH technische Detection-Felder (queryOrRule,
   * explanation, language, mitre, severity). Kein Free-Text, kein testCases,
   * keine description — diese können Incident-PII enthalten.
   *
   * @param {object} draft  — Plain-JSON-Objekt eines UseCaseDraft (aus repo.findById)
   * @param {string} actor  — user.id / user.email des Publizierenden
   * @returns {PublishedDetection}
   */
  static create(draft, actor) {
    const dl = (draft && draft.detectionLogic) || {};
    return new PublishedDetection({
      id:          randomUUID(),
      draftId:     draft.id     || '',
      ucNumber:    draft.ucNumber || null,
      title:       draft.title  || '',
      language:    dl.language  || 'generic',
      rule:        dl.queryOrRule   || '',
      explanation: dl.explanation   || '',
      // Deep-Copy: mitre-Array darf keine geteilte Referenz zum Draft haben
      mitre:       JSON.parse(JSON.stringify(Array.isArray(draft.mitre) ? draft.mitre : [])),
      severity:    draft.severity  || 'medium',
      sourceType:  draft.sourceType || '',
      sourceId:    draft.sourceId   || '',
      publishedBy: actor || '',
      createdAt:   new Date().toISOString(),
    });
  }

  // ─── Serialisierung ───────────────────────────────────────────────────────

  toJSON() {
    return JSON.parse(JSON.stringify({ ...this }));
  }
}

module.exports = { PublishedDetection };
