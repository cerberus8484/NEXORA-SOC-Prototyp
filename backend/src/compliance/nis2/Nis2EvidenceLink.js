'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Nis2EvidenceLink (P_NIS2_1) — verweist auf einen Nachweis je Assessment.
//
// Speichert NUR eine Referenz + Metadaten — NIE ein Secret/Token/Credential.
// URLs werden hart validiert (http/https, kein user:password@, keine
// Secret-Query-Keys), damit nie Geheimnisse über die Evidence-Ref leaken.
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const { err, assertSafeText, assertSafeEvidenceRef, assertIsoDateOrNull } = require('./nis2Validation');

const EVIDENCE_TYPES = Object.freeze([
  'ticket',
  'audit_event',
  'node',
  'integration',
  'gitops_profile',
  'document',
  'external_reference',
  'other',
]);

const REF_MAX = 1024;
const TITLE_MAX = 200;
const DESC_MAX = 2000;

class Nis2EvidenceLink {
  constructor({ id = randomUUID(), assessmentId, evidenceType, evidenceRef, title, description = '', capturedAt = null, createdAt, createdBy = '' } = {}) {
    this.id = id; this.assessmentId = assessmentId; this.evidenceType = evidenceType;
    this.evidenceRef = evidenceRef; this.title = title; this.description = description;
    this.capturedAt = capturedAt;
    this.createdAt = createdAt || new Date().toISOString();
    this.createdBy = createdBy;
  }

  static create(data = {}, actor = '') {
    if (!data.assessmentId) throw err('assessmentId ist erforderlich');
    if (!EVIDENCE_TYPES.includes(data.evidenceType)) {
      throw err(`evidenceType ungültig: '${data.evidenceType}' (erlaubt: ${EVIDENCE_TYPES.join(', ')})`);
    }
    const evidenceRef = assertSafeEvidenceRef(data.evidenceRef, 'evidenceRef', REF_MAX);
    const title = assertSafeText(data.title, 'title', TITLE_MAX);
    if (!title || title.trim() === '') throw err('title ist erforderlich');
    const description = assertSafeText(data.description, 'description', DESC_MAX);
    const capturedAt = assertIsoDateOrNull(data.capturedAt, 'capturedAt');
    const now = new Date().toISOString();
    return new Nis2EvidenceLink({
      id: randomUUID(), assessmentId: String(data.assessmentId), evidenceType: data.evidenceType,
      evidenceRef, title, description, capturedAt, createdAt: now, createdBy: String(actor || ''),
    });
  }

  toJSON() {
    return {
      id: this.id, assessmentId: this.assessmentId, evidenceType: this.evidenceType,
      evidenceRef: this.evidenceRef, title: this.title, description: this.description,
      capturedAt: this.capturedAt, createdAt: this.createdAt, createdBy: this.createdBy,
    };
  }
}

module.exports = { Nis2EvidenceLink, EVIDENCE_TYPES, REF_MAX, TITLE_MAX, DESC_MAX };
