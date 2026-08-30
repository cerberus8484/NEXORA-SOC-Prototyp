'use strict';

const { randomUUID } = require('crypto');

/**
 * ResponseAction — privilegierte Hunt-Aktion mit Genehmigungs-Gate (Stufe 2).
 *
 * Prinzip: Analyst STELLT EINE ANFRAGE, ein zweiter (autorisierter) Mensch
 * GENEHMIGT — Vier-Augen (requestedBy ≠ approvedBy). Es wird NICHTS real
 * ausgeführt (kein Agent) — genehmigte Aktionen bleiben 'approved' mit Hinweis
 * "pending agent". Jeder Schritt ist auditierbar.
 *
 * Status: requested → approved | rejected   (executing/completed erst mit Agent, Stufe 3)
 */
const KINDS = ['isolate_host', 'release_isolation', 'privileged_command'];
const STATUSES = ['requested', 'approved', 'rejected', 'executing', 'completed', 'failed', 'expired'];

const RISK_TIER = {
  isolate_host:      'containment',
  release_isolation: 'containment',
  privileged_command: 'privileged',
};

class ResponseAction {
  constructor(p = {}) {
    this.id              = p.id || randomUUID();
    this.huntSessionId   = String(p.huntSessionId || '');
    this.targetHost      = String(p.targetHost || '');
    this.kind            = p.kind;
    this.command         = String(p.command || '');
    this.reason          = String(p.reason || '');
    this.riskTier        = RISK_TIER[p.kind] || 'privileged';
    this.status          = STATUSES.includes(p.status) ? p.status : 'requested';
    this.requestedBy     = p.requestedBy || null;
    this.requestedAt     = p.requestedAt || new Date().toISOString();
    this.approvedBy      = p.approvedBy || null;
    this.approvedAt      = p.approvedAt || null;
    // Wer die ECHTE Ausführung ausgelöst hat (ADR-042, Stufe 3). Für die Drei-Parteien-
    // Trennung requestedBy ≠ approvedBy ≠ executedBy + Audit. Null solange nicht real ausgeführt.
    this.executedBy      = p.executedBy || null;
    this.rejectionReason = String(p.rejectionReason || '');
    this.note            = String(p.note || '');
    // Dokumentierte Rechts-/Genehmigungsgrundlage (z.B. Betriebsrat-Zustimmung,
    // Notfall-Freigabe). Pflicht bei der Genehmigung — der Governance-Nachweis,
    // dass die privilegierte Maßnahme befugt erfolgte. Kein Secret.
    this.authorizationBasis = String(p.authorizationBasis || '');
  }

  static create({ huntSessionId, targetHost, kind, command = '', reason = '', requestedBy }) {
    if (!huntSessionId) throw Object.assign(new Error('huntSessionId ist Pflicht'), { status: 400 });
    if (!KINDS.includes(kind)) throw Object.assign(new Error(`Unbekannte kind: ${kind} — erlaubt: ${KINDS.join(', ')}`), { status: 400 });
    if (kind === 'privileged_command' && !String(command).trim()) {
      throw Object.assign(new Error('privileged_command erfordert command'), { status: 400 });
    }
    return new ResponseAction({ huntSessionId, targetHost, kind, command, reason, requestedBy, status: 'requested' });
  }

  static fromPersistence(raw) { return new ResponseAction(raw); }

  /**
   * Genehmigen — Vier-Augen: approver ≠ requester. Kein realer Exec (kein Agent).
   * `authorizationBasis` ist PFLICHT: die privilegierte Maßnahme darf NUR mit
   * dokumentierter Grundlage (Betriebsrat-Zustimmung / Notfall-Freigabe / …)
   * freigegeben werden — ohne Beleg keine Freigabe.
   */
  approve(approverId, authorizationBasis) {
    this._assertRequested();
    if (approverId && this.requestedBy && approverId === this.requestedBy) {
      throw Object.assign(new Error('Vier-Augen-Prinzip: Genehmiger darf nicht der Anforderer sein'), { status: 403 });
    }
    const basis = String(authorizationBasis || '').trim();
    if (!basis) {
      throw Object.assign(
        new Error('Freigabe nur mit dokumentierter Grundlage (z.B. Betriebsrat-Zustimmung / Notfall-Freigabe) — Pflichtfeld'),
        { status: 400 },
      );
    }
    this.status             = 'approved';
    this.approvedBy         = approverId || null;
    this.approvedAt         = new Date().toISOString();
    this.authorizationBasis = basis;
    this.note               = 'Genehmigt — Ausführung ausstehend (kein Agent verbunden, Stufe 3).';
    return this;
  }

  reject(approverId, reason = '') {
    this._assertRequested();
    this.status          = 'rejected';
    this.approvedBy      = approverId || null;
    this.approvedAt      = new Date().toISOString();
    this.rejectionReason = String(reason || '');
    return this;
  }

  startExecution(note = '') {
    if (this.status !== 'approved') {
      throw Object.assign(new Error(`Ausfuehrung nur aus approved moeglich (Status: ${this.status})`), { status: 409 });
    }
    this.status = 'executing';
    this.note = String(note || this.note || '').trim();
    return this;
  }

  completeExecution(note = '') {
    if (this.status !== 'executing') {
      throw Object.assign(new Error(`Abschluss nur aus executing moeglich (Status: ${this.status})`), { status: 409 });
    }
    this.status = 'completed';
    this.note = String(note || this.note || '').trim();
    return this;
  }

  failExecution(reason = '') {
    if (this.status !== 'approved' && this.status !== 'executing') {
      throw Object.assign(new Error(`Fehlerstatus nur aus approved/executing moeglich (Status: ${this.status})`), { status: 409 });
    }
    this.status = 'failed';
    this.note = String(reason || this.note || '').trim();
    return this;
  }

  _assertRequested() {
    if (this.status !== 'requested') {
      throw Object.assign(new Error(`Aktion wurde bereits beurteilt (Status: ${this.status})`), { status: 409 });
    }
  }

  toJSON() {
    return {
      id: this.id, huntSessionId: this.huntSessionId, targetHost: this.targetHost,
      kind: this.kind, command: this.command, reason: this.reason, riskTier: this.riskTier,
      status: this.status, requestedBy: this.requestedBy, requestedAt: this.requestedAt,
      approvedBy: this.approvedBy, approvedAt: this.approvedAt, executedBy: this.executedBy,
      rejectionReason: this.rejectionReason, note: this.note,
      authorizationBasis: this.authorizationBasis,
    };
  }
}

module.exports = { ResponseAction, KINDS, STATUSES, RISK_TIER };
