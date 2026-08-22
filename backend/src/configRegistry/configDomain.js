'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CONFIG_1 — Config-Lifecycle-Domain (rein, KEIN Apply/Reload/Restart/Shell).
//
// Getrennte, nachvollziehbare Zustände: Draft → Validierung (Service) →
// Risikoanzeige (Capability) → Approval-State-Machine → Audit.
// `approved` bedeutet ausdrücklich NICHT `applied` — es gibt keinen Apply-Pfad.
//
// Versioniert + optimistisch gesperrt: jede Mutation verlangt expectedVersion
// und erhöht version, damit keine Änderung still eine andere überschreibt.
// Stil wie provisioningDomain: static create(), immutable transitionTo(), toJSON().
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const { err, assertNoSecretKeys } = require('./configCapabilityCatalog');

const DRAFT_STATUS = ['draft', 'pending_approval', 'approved', 'rejected'];
// approved ist terminal (kein Apply!). rejected/pending_approval können zurück zu draft.
const DRAFT_TRANSITIONS = {
  draft:            ['pending_approval'],
  pending_approval: ['approved', 'rejected', 'draft'],
  approved:         [],
  rejected:         ['draft'],
};

const AUDIT_EVENTS = {
  DRAFT_CREATED:   'config.draft.created',
  DRAFT_REVISED:   'config.draft.revised',
  DRAFT_SUBMITTED: 'config.draft.submitted',
  DRAFT_APPROVED:  'config.draft.approved',
  DRAFT_REJECTED:  'config.draft.rejected',
  DRAFT_REOPENED:  'config.draft.reopened',
  // Reines Audit-Konzept: ein Apply-Versuch wäre blockiert (es gibt keinen Pfad).
  APPLY_BLOCKED:   'config.apply.blocked',
};
const AUDIT_EVENT_NAMES = Object.values(AUDIT_EVENTS);

function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) throw err(`${field} ungültig: '${value}' (erlaubt: ${allowed.join(', ')})`);
}
function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw err(`${field} fehlt oder ist leer`);
}
function assertVersion(expected, actual) {
  if (Number(expected) !== Number(actual)) {
    throw err(`Optimistic-Lock-Konflikt: expectedVersion ${expected} ≠ aktuelle Version ${actual}`, 409);
  }
}
function guardTransition(from, to) {
  assertEnum(to, DRAFT_STATUS, 'status');
  if (from === to) return;
  if (!(DRAFT_TRANSITIONS[from] || []).includes(to)) throw err(`ungültige transition: ${from} → ${to}`);
}

// ─── ConfigDraft ────────────────────────────────────────────────────────────
class ConfigDraft {
  constructor({ id = randomUUID(), capabilityId, targetId, value = {}, status = 'draft', version = 1, revision = 1, createdBy = '', createdAt, updatedAt } = {}) {
    this.id = id; this.capabilityId = capabilityId; this.targetId = targetId;
    this.value = value; this.status = status; this.version = version; this.revision = revision;
    this.createdBy = String(createdBy || '');
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt || this.createdAt;
    // Bewusst KEINE apply()/exec()/reload()/restart()-Methode — kein Apply-Pfad.
  }
  static create({ capabilityId, targetId, value, createdBy } = {}) {
    assertNonEmpty(capabilityId, 'capabilityId');
    assertNonEmpty(targetId, 'targetId');
    assertNoSecretKeys(value, 'value');
    const now = new Date().toISOString();
    return new ConfigDraft({ id: randomUUID(), capabilityId, targetId, value: value ?? {}, status: 'draft', version: 1, revision: 1, createdBy, createdAt: now, updatedAt: now });
  }
  /** Neuer Wert → neue Revision (nur im Status draft), optimistisch gesperrt. */
  withValue(value, expectedVersion) {
    if (this.status !== 'draft') throw err(`Wert nur im Status 'draft' änderbar (aktuell: ${this.status})`);
    assertVersion(expectedVersion, this.version);
    assertNoSecretKeys(value, 'value');
    return new ConfigDraft({ ...this.toJSON(), value: value ?? {}, version: this.version + 1, revision: this.revision + 1, updatedAt: new Date().toISOString() });
  }
  /** Lifecycle-Übergang (optimistisch gesperrt). KEIN Apply. */
  transitionTo(status, expectedVersion) {
    assertVersion(expectedVersion, this.version);
    guardTransition(this.status, status);
    return new ConfigDraft({ ...this.toJSON(), status, version: this.version + 1, updatedAt: new Date().toISOString() });
  }
  toJSON() {
    return { id: this.id, capabilityId: this.capabilityId, targetId: this.targetId, value: this.value, status: this.status, version: this.version, revision: this.revision, createdBy: this.createdBy, createdAt: this.createdAt, updatedAt: this.updatedAt };
  }
}

// ─── ConfigDraftRevision (Wert-Historie; append-only je Draft) ──────────────
class ConfigDraftRevision {
  constructor({ id = randomUUID(), draftId, revision, value = {}, createdBy = '', createdAt } = {}) {
    this.id = id; this.draftId = draftId; this.revision = revision; this.value = value;
    this.createdBy = String(createdBy || ''); this.createdAt = createdAt || new Date().toISOString();
  }
  static create({ draftId, revision, value, createdBy } = {}) {
    assertNonEmpty(draftId, 'draftId');
    if (!Number.isInteger(revision) || revision < 1) throw err('revision muss eine Ganzzahl ≥ 1 sein');
    assertNoSecretKeys(value, 'value');
    return new ConfigDraftRevision({ id: randomUUID(), draftId, revision, value: value ?? {}, createdBy, createdAt: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, draftId: this.draftId, revision: this.revision, value: this.value, createdBy: this.createdBy, createdAt: this.createdAt }; }
}

// ─── ConfigApproval (Freigabe-Entscheid; NICHT Apply) ───────────────────────
class ConfigApproval {
  constructor({ id = randomUUID(), draftId, decision, decidedBy = '', note = '', decidedAt } = {}) {
    this.id = id; this.draftId = draftId; this.decision = decision;
    this.decidedBy = String(decidedBy || ''); this.note = String(note || '');
    this.decidedAt = decidedAt || new Date().toISOString();
    // approved ≠ applied: dieser Datensatz löst KEINEN Apply aus.
  }
  static create({ draftId, decision, decidedBy, note } = {}) {
    assertNonEmpty(draftId, 'draftId');
    assertEnum(decision, ['approved', 'rejected'], 'decision');
    return new ConfigApproval({ id: randomUUID(), draftId, decision, decidedBy, note: note || '', decidedAt: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, draftId: this.draftId, decision: this.decision, decidedBy: this.decidedBy, note: this.note, decidedAt: this.decidedAt }; }
}

// ─── ConfigChangeAudit (append-only, redigierter Vorher/Nachher-Diff) ───────
class ConfigChangeAudit {
  constructor({ id = randomUUID(), type, actor = null, capabilityId, targetId = null, draftId = null, before = null, after = null, at } = {}) {
    this.id = id; this.type = type; this.actor = actor; this.capabilityId = capabilityId;
    this.targetId = targetId; this.draftId = draftId; this.before = before; this.after = after;
    this.at = at || new Date().toISOString();
    // append-only: bewusst KEINE update()/delete()-Methode.
  }
  static create({ type, actor, capabilityId, targetId, draftId, before, after } = {}) {
    assertEnum(type, AUDIT_EVENT_NAMES, 'type');
    assertNonEmpty(capabilityId, 'capabilityId');
    // before/after sind bereits redigiert (Service redigiert via Capability.redact);
    // zusätzlicher Backstop: keine Secret-Keys im Klartext.
    assertNoSecretKeys(before, 'before'); assertNoSecretKeys(after, 'after');
    return new ConfigChangeAudit({ id: randomUUID(), type, actor: actor || null, capabilityId, targetId: targetId || null, draftId: draftId || null, before: before ?? null, after: after ?? null, at: new Date().toISOString() });
  }
  toJSON() { return { id: this.id, type: this.type, actor: this.actor, capabilityId: this.capabilityId, targetId: this.targetId, draftId: this.draftId, before: this.before, after: this.after, at: this.at }; }
}

module.exports = {
  ConfigDraft, ConfigDraftRevision, ConfigApproval, ConfigChangeAudit,
  DRAFT_STATUS, DRAFT_TRANSITIONS, AUDIT_EVENTS, AUDIT_EVENT_NAMES,
};
