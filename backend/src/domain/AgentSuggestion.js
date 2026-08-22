'use strict';

const { randomUUID } = require('crypto');

const KINDS    = [
  'triage', 'action', 'enrichment',
  // Analyst-Copilot-Vorschlagstypen:
  'false_positive_review', 'incident_recommendation', 'customer_response',
  'report_draft', 'hunt_suggestion',
  // KI-Analyse-Tab — jetzt live:
  'evidence_explanation', 'mitre_mapping', 'next_steps',
];
const STATUSES = ['pending', 'approved', 'rejected'];

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

/**
 * AgentSuggestion — ein vom KI-Agenten erzeugter Vorschlag zu einem Ticket.
 *
 * Kernidee P19 Alpha: Der Agent SCHLÄGT VOR, ein Mensch ENTSCHEIDET.
 * Jede Suggestion startet 'pending' und wird per approve()/reject() beurteilt.
 * Es wird nie automatisch gehandelt — Human-in-the-Loop.
 */
class AgentSuggestion {
  constructor({
    id, ticketId, kind = 'triage', proposal = '', rationale = '', verdict = '',
    confidence = 0, status = 'pending', createdBy = 'agent', model = '',
    reviewedBy = null, reviewReason = '', reviewedAt = null, createdAt,
    analysis = null,
  } = {}) {
    this.id           = id || randomUUID();
    this.ticketId     = String(ticketId || '');
    this.kind         = kind;
    this.proposal     = String(proposal || '');
    this.rationale    = String(rationale || '');
    this.verdict      = String(verdict || '');
    this.confidence   = clamp01(confidence);
    this.status       = STATUSES.includes(status) ? status : 'pending';
    this.createdBy    = createdBy || 'agent';
    this.model        = String(model || '');
    this.reviewedBy   = reviewedBy;
    this.reviewReason = String(reviewReason || '');
    this.reviewedAt   = reviewedAt;
    this.createdAt    = createdAt || new Date().toISOString();
    this.analysis     = (analysis && typeof analysis === 'object') ? analysis : null;
  }

  isValid() {
    return Boolean(this.ticketId) && KINDS.includes(this.kind) && Boolean(this.proposal);
  }

  /** Genehmigt den Vorschlag — nur aus 'pending' erlaubt. */
  approve(userId) {
    this._assertPending();
    this.status     = 'approved';
    this.reviewedBy = userId || null;
    this.reviewedAt = new Date().toISOString();
    return this;
  }

  /** Lehnt den Vorschlag ab — nur aus 'pending' erlaubt. */
  reject(userId, reason = '') {
    this._assertPending();
    this.status       = 'rejected';
    this.reviewedBy   = userId || null;
    this.reviewReason = String(reason || '');
    this.reviewedAt   = new Date().toISOString();
    return this;
  }

  /** Umsetzbar nur wenn genehmigt UND Confidence über Schwelle. */
  isActionable(threshold = 0.5) {
    return this.status === 'approved' && this.confidence >= threshold;
  }

  _assertPending() {
    if (this.status !== 'pending') {
      throw Object.assign(
        new Error(`Suggestion wurde bereits beurteilt (Status: ${this.status})`),
        { status: 409 }
      );
    }
  }

  toJSON() {
    return {
      id: this.id, ticketId: this.ticketId, kind: this.kind, proposal: this.proposal,
      rationale: this.rationale, verdict: this.verdict, confidence: this.confidence, status: this.status,
      createdBy: this.createdBy, model: this.model, reviewedBy: this.reviewedBy,
      reviewReason: this.reviewReason, reviewedAt: this.reviewedAt, createdAt: this.createdAt,
      analysis: this.analysis,
    };
  }
}

module.exports = { AgentSuggestion, KINDS, STATUSES };
