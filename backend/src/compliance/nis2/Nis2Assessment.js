'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Nis2Assessment (P_NIS2_1) — Arbeitsstand pro Control (eine Bewertung je controlKey).
//
// `status: addressed` heißt NUR "Arbeitsstand bearbeitet" — NICHT rechtlich
// konform/zertifiziert. Die ehrliche Bewertung (Evidence vorhanden? überfällig?)
// passiert berechnet im ReadinessService, nicht als Behauptung im Modell.
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const { isKnownControlKey } = require('./nis2ControlCatalog');
const { err, assertSafeText, assertIsoDateOrNull } = require('./nis2Validation');

const ASSESSMENT_STATUS = Object.freeze([
  'not_started',
  'in_progress',
  'evidence_collected',
  'needs_review',
  'addressed',
  'not_applicable',
]);

const OWNER_MAX = 120;
const NOTES_MAX = 4000;

class Nis2Assessment {
  constructor({ id = randomUUID(), controlKey, status = 'not_started', owner = '', dueDate = null, notes = '', lastReviewedAt = null, createdAt, updatedAt, createdBy = '', updatedBy = '' } = {}) {
    this.id = id; this.controlKey = controlKey; this.status = status;
    this.owner = owner; this.dueDate = dueDate; this.notes = notes;
    this.lastReviewedAt = lastReviewedAt;
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || this.createdAt;
    this.createdBy = createdBy; this.updatedBy = updatedBy;
  }

  // Validiert + normalisiert; wirft mit { status: 400 }. Gibt bereinigte Felder zurück.
  static validateInput(data = {}) {
    if (!isKnownControlKey(data.controlKey)) throw err(`controlKey unbekannt: '${data.controlKey}'`);
    const status = data.status ?? 'not_started';
    if (!ASSESSMENT_STATUS.includes(status)) throw err(`status ungültig: '${status}' (erlaubt: ${ASSESSMENT_STATUS.join(', ')})`);
    const owner = assertSafeText(data.owner, 'owner', OWNER_MAX);
    const notes = assertSafeText(data.notes, 'notes', NOTES_MAX);
    const dueDate = assertIsoDateOrNull(data.dueDate, 'dueDate');
    const lastReviewedAt = assertIsoDateOrNull(data.lastReviewedAt, 'lastReviewedAt');
    // "not_applicable" verlangt eine nachvollziehbare Begründung (notes).
    if (status === 'not_applicable' && (!notes || notes.trim() === '')) {
      throw err('not_applicable benötigt eine Begründung in notes');
    }
    return { status, owner, notes, dueDate, lastReviewedAt };
  }

  static create(data = {}, actor = '') {
    const v = Nis2Assessment.validateInput(data);
    const now = new Date().toISOString();
    return new Nis2Assessment({
      id: randomUUID(), controlKey: data.controlKey, status: v.status,
      owner: v.owner, dueDate: v.dueDate, notes: v.notes, lastReviewedAt: v.lastReviewedAt,
      createdAt: now, updatedAt: now, createdBy: String(actor || ''), updatedBy: String(actor || ''),
    });
  }

  /** Immutables Update — controlKey ist unveränderlich. */
  update(patch = {}, actor = '') {
    const merged = { ...this.toJSON(), ...patch, controlKey: this.controlKey };
    const v = Nis2Assessment.validateInput(merged);
    return new Nis2Assessment({
      id: this.id, controlKey: this.controlKey, status: v.status,
      owner: v.owner, dueDate: v.dueDate, notes: v.notes, lastReviewedAt: v.lastReviewedAt,
      createdAt: this.createdAt, createdBy: this.createdBy,
      updatedAt: new Date().toISOString(), updatedBy: String(actor || ''),
    });
  }

  toJSON() {
    return {
      id: this.id, controlKey: this.controlKey, status: this.status, owner: this.owner,
      dueDate: this.dueDate, notes: this.notes, lastReviewedAt: this.lastReviewedAt,
      createdAt: this.createdAt, updatedAt: this.updatedAt, createdBy: this.createdBy, updatedBy: this.updatedBy,
    };
  }
}

module.exports = { Nis2Assessment, ASSESSMENT_STATUS, OWNER_MAX, NOTES_MAX };
