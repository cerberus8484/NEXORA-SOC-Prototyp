'use strict';

const { randomUUID } = require('crypto');

// ─── Status-Statemaschine ─────────────────────────────────────────────────────
//
//   draft → in_review → approved → published
//                    ↘ rejected
//
//   Ungültige Übergänge werfen sofort (fail-fast, kein stilles Verschlucken).
//
// ─────────────────────────────────────────────────────────────────────────────

const UCD_STATUSES     = ['draft', 'in_review', 'approved', 'rejected', 'published'];
const UCD_SOURCE_TYPES = ['ticket', 'finding', 'evidence', 'wazuh_rule', 'manual'];
const UCD_SEVERITIES   = ['low', 'medium', 'high', 'critical'];
const UCD_LANGUAGES    = ['wazuh', 'sigma', 'splunk', 'qradar', 'generic'];

// Erlaubte Übergänge: fromStatus → Set<toStatus>
const ALLOWED_TRANSITIONS = {
  draft:      new Set(['in_review']),
  in_review:  new Set(['approved', 'rejected']),
  approved:   new Set(['published']),
  rejected:   new Set([]),
  published:  new Set([]),
};

// Gültige Test-Case-Typen
const TEST_CASE_TYPES = ['true_positive', 'false_positive'];

// ─── DSGVO-Hinweis ───────────────────────────────────────────────────────────
// Drafts können aus Tickets/Evidence PII enthalten (IPs, Hostnames, User-IDs
// in detectionLogic.queryOrRule und testCases[].event).
// Die Domain erzwingt keine Speicherung roher PII über das Nötige hinaus.
// Pflicht des Providers (Agent UCD-C): Beispiel-Events minimieren — nur
// synthetische/anonymisierte Werte in testCases.event verwenden.
// Art. 5 Abs. 1 lit. c DSGVO: Datensparsamkeit. Art. 32 DSGVO: TOM.
// ─────────────────────────────────────────────────────────────────────────────

class UseCaseDraft {
  constructor({
    id              = randomUUID(),
    ucNumber        = null,
    title           = '',
    sourceType      = 'manual',
    sourceId        = '',
    status          = 'draft',
    description     = '',
    detectionGoal   = '',
    dataSources     = [],
    requiredFields  = [],
    detectionLogic  = { language: 'generic', queryOrRule: '', explanation: '' },
    mitre           = [],
    severity        = 'medium',
    confidence      = 0,
    falsePositiveRisks   = [],
    testCases       = [],
    recommendedActions   = [],
    playbookSteps   = [],
    generatedBy     = 'ollama',
    reviewedBy      = null,
    createdAt       = new Date().toISOString(),
    updatedAt       = new Date().toISOString(),
  } = {}) {
    this.id             = id;
    this.ucNumber       = ucNumber || null;   // UC-INC000001; bei Erstellung vergeben, danach immutabel
    this.title          = String(title || '');
    this.sourceType     = UCD_SOURCE_TYPES.includes(sourceType) ? sourceType : 'manual';
    this.sourceId       = String(sourceId || '');
    this.status         = UCD_STATUSES.includes(status) ? status : 'draft';
    this.description    = String(description || '');
    this.detectionGoal  = String(detectionGoal || '');
    this.dataSources    = Array.isArray(dataSources) ? dataSources : [];
    this.requiredFields = Array.isArray(requiredFields) ? requiredFields : [];
    this.detectionLogic = _normalizeDetectionLogic(detectionLogic);
    this.mitre          = Array.isArray(mitre) ? mitre : [];
    this.severity       = UCD_SEVERITIES.includes(severity) ? severity : 'medium';
    this.confidence     = _clampConfidence(confidence);
    this.falsePositiveRisks  = Array.isArray(falsePositiveRisks) ? falsePositiveRisks : [];
    this.testCases      = Array.isArray(testCases) ? testCases : [];
    this.recommendedActions  = Array.isArray(recommendedActions) ? recommendedActions : [];
    this.playbookSteps  = Array.isArray(playbookSteps) ? playbookSteps : [];
    this.generatedBy    = String(generatedBy || 'ollama');
    this.reviewedBy     = reviewedBy || null;
    this.createdAt      = createdAt;
    this.updatedAt      = updatedAt;
  }

  // ─── Factory ──────────────────────────────────────────────────────────────

  static create(data) {
    const now = new Date().toISOString();
    return new UseCaseDraft({ ...data, id: randomUUID(), createdAt: now, updatedAt: now });
  }

  // ─── Status-Übergänge ────────────────────────────────────────────────────

  /** draft → in_review */
  sendToReview() {
    this._transition('in_review');
    return this;
  }

  /** in_review → approved */
  approve(userId) {
    this._transition('approved');
    this.reviewedBy = userId || null;
    this.updatedAt  = new Date().toISOString();
    return this;
  }

  /** in_review → rejected */
  reject(userId) {
    this._transition('rejected');
    this.reviewedBy = userId || null;
    this.updatedAt  = new Date().toISOString();
    return this;
  }

  /** approved → published */
  publish() {
    this._transition('published');
    return this;
  }

  // ─── Update (partiell, Whitelist) ─────────────────────────────────────────

  update(patch = {}) {
    const allowed = [
      'title', 'description', 'detectionGoal', 'dataSources', 'requiredFields',
      'detectionLogic', 'mitre', 'severity', 'confidence', 'falsePositiveRisks',
      'testCases', 'recommendedActions', 'playbookSteps',
    ];
    allowed.forEach((k) => {
      if (patch[k] !== undefined) this[k] = patch[k];
    });
    if (patch.confidence !== undefined) {
      this.confidence = _clampConfidence(patch.confidence);
    }
    if (patch.detectionLogic !== undefined) {
      this.detectionLogic = _normalizeDetectionLogic(patch.detectionLogic);
    }
    this.updatedAt = new Date().toISOString();
    return this;
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  isValid() {
    return Boolean(this.title) && UCD_SOURCE_TYPES.includes(this.sourceType);
  }

  // ─── Serialisierung ───────────────────────────────────────────────────────

  toJSON() {
    // Deep-Clone: verschachtelte Objekte/Arrays (detectionLogic, mitre, testCases …)
    // dürfen nach außen keine geteilten Referenzen sein. { ...this } zuerst, damit
    // JSON.stringify NICHT rekursiv toJSON() aufruft (Endlosschleife).
    return JSON.parse(JSON.stringify({ ...this }));
  }

  // ─── Intern ───────────────────────────────────────────────────────────────

  _transition(toStatus) {
    const allowed = ALLOWED_TRANSITIONS[this.status];
    if (!allowed || !allowed.has(toStatus)) {
      throw Object.assign(
        new Error(
          `Ungültiger Status-Übergang: ${this.status} → ${toStatus}. ` +
          `Erlaubt: ${allowed ? [...allowed].join(', ') || 'keiner' : 'keiner'}`
        ),
        { status: 409 }
      );
    }
    this.status    = toStatus;
    this.updatedAt = new Date().toISOString();
  }
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function _clampConfidence(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function _normalizeDetectionLogic(dl) {
  if (!dl || typeof dl !== 'object') {
    return { language: 'generic', queryOrRule: '', explanation: '' };
  }
  return {
    language:    UCD_LANGUAGES.includes(dl.language) ? dl.language : 'generic',
    queryOrRule: String(dl.queryOrRule || ''),
    explanation: String(dl.explanation || ''),
  };
}

module.exports = {
  UseCaseDraft,
  UCD_STATUSES,
  UCD_SOURCE_TYPES,
  UCD_SEVERITIES,
  UCD_LANGUAGES,
  TEST_CASE_TYPES,
  ALLOWED_TRANSITIONS,
};
