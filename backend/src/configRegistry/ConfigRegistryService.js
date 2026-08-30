'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CONFIG_1 — ConfigRegistryService (Slice 1).
//
// Orchestriert den kontrollierten Konfigurations-Lifecycle:
//   typisiertes Formular → Validierung → Draft → Risikoanzeige → Approval → Audit.
//
// ES GIBT KEINEN APPLY-PFAD. `approved` ≠ `applied`. Keine Apply-/Exec-/Shell-/
// SSH-/Restart-/Reload-Methode, keine Netz-/Datei-Operation.
// RBAC: read = jede Rolle; create/edit/submit = engineer|admin; approve = admin
// (Vier-Augen-Prinzip: der Ersteller darf nicht selbst freigeben).
// Sensitive Felder werden in Draft-Ausgabe, Diff und Audit redigiert.
// ─────────────────────────────────────────────────────────────────────────

const {
  getCapability, listCapabilities, listTargets, assertTargetAllowed, err,
} = require('./configCapabilityCatalog');
const {
  ConfigDraft, ConfigDraftRevision, ConfigApproval, ConfigChangeAudit, AUDIT_EVENTS,
} = require('./configDomain');
const { validateValue, buildApplyPlan, defaultsOf } = require('./applyPlan');

const EDIT_ROLES = ['engineer', 'admin'];
const APPROVE_ROLES = ['admin'];

function actorOf(actor = {}) { return { id: actor.id || actor.sub || null, role: actor.role || '', label: actor.label || actor.email || actor.id || actor.sub || '' }; }
function requireRole(actor, roles) {
  if (!roles.includes(actor.role)) throw err(`Rolle '${actor.role || '—'}' nicht berechtigt (erlaubt: ${roles.join(', ')})`, 403);
}

class ConfigRegistryService {
  constructor({ repo } = {}) {
    if (!repo) throw new Error('ConfigRegistryService: repo erforderlich');
    this._repo = repo;
  }

  // ── Read (Allowlist + Risikoanzeige) ──────────────────────────────────────
  listCapabilities() { return listCapabilities().map((c) => c.toJSON()); }
  getCapability(id) { return getCapability(id).toJSON(); } // unknown → 400 deny
  listTargets() { return listTargets().map((t) => t.toJSON()); }

  async listDrafts(filter = {}) {
    const drafts = await this._repo.listDrafts(filter);
    return drafts.map((d) => this._redactDraft(d));
  }
  async getDraft(id) {
    const d = await this._repo.findDraftById(id);
    if (!d) throw err('Draft nicht gefunden', 404);
    return this._redactDraft(d);
  }
  async listAudit(filter = {}) { return this._repo.listAudit(filter); } // bereits redigiert gespeichert

  // ── P_CORR_ADMIN_2 Stufe 1: separate Validierung + Apply-Plan (KEIN Apply) ──

  /** Separate, nicht-werfende Validierung des aktuell gespeicherten Draft-Werts. */
  async validateDraft(draftId) {
    const d = await this._loadDraft(draftId);
    const cap = getCapability(d.capabilityId); // unknown = deny
    return { draftId: d.id, capabilityId: cap.id, ...validateValue(cap, d.value) };
  }

  /**
   * Redigiertes Apply-Plan-Artefakt für einen Draft. Baseline = Capability-Defaults
   * (es existiert KEIN angewendeter Wert). Erzeugt NUR eine Vorschau — kein Apply.
   */
  async buildPlan(draftId) {
    const d = await this._loadDraft(draftId);
    const cap = getCapability(d.capabilityId); // unknown = deny
    return {
      draftId: d.id,
      draftStatus: d.status,
      ...buildApplyPlan({ capability: cap, targetId: d.targetId, before: defaultsOf(cap), after: d.value }),
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  async createDraft({ capabilityId, targetId, value, actor } = {}) {
    const a = actorOf(actor); requireRole(a, EDIT_ROLES);
    const cap = getCapability(capabilityId);                 // unknown = deny
    if (!cap.editable) throw err(`Capability '${cap.id}' ist reserviert und nicht editierbar`, 403);
    assertTargetAllowed(cap, targetId);                       // unknown/ungültiges Ziel = deny
    const clean = cap.validateValue(value);                   // Schema + Defaults + no-secret-keys

    const draft = ConfigDraft.create({ capabilityId: cap.id, targetId, value: clean, createdBy: a.label });
    await this._repo.createDraft(draft.toJSON());
    await this._repo.addRevision(ConfigDraftRevision.create({ draftId: draft.id, revision: 1, value: clean, createdBy: a.label }).toJSON());
    await this._audit(AUDIT_EVENTS.DRAFT_CREATED, a, cap, draft, null, clean);
    return this._redactDraft(draft.toJSON());
  }

  async updateDraftValue({ draftId, value, expectedVersion, actor } = {}) {
    const a = actorOf(actor); requireRole(a, EDIT_ROLES);
    const cur = await this._loadDraft(draftId);
    const cap = getCapability(cur.capabilityId);
    const clean = cap.validateValue(value);
    const next = new ConfigDraft(cur).withValue(clean, expectedVersion); // Status-/Version-Guard
    await this._repo.updateDraft(next.toJSON(), cur.version);            // Compare-and-Set
    await this._repo.addRevision(ConfigDraftRevision.create({ draftId, revision: next.revision, value: clean, createdBy: a.label }).toJSON());
    await this._audit(AUDIT_EVENTS.DRAFT_REVISED, a, cap, next, cur.value, clean);
    return this._redactDraft(next.toJSON());
  }

  async submitForApproval({ draftId, expectedVersion, actor } = {}) {
    const a = actorOf(actor); requireRole(a, EDIT_ROLES);
    const cur = await this._loadDraft(draftId);
    const cap = getCapability(cur.capabilityId);
    const next = new ConfigDraft(cur).transitionTo('pending_approval', expectedVersion);
    await this._repo.updateDraft(next.toJSON(), cur.version);
    await this._audit(AUDIT_EVENTS.DRAFT_SUBMITTED, a, cap, next, cur.value, next.value);
    return this._redactDraft(next.toJSON());
  }

  /** Freigabe/Ablehnung. WICHTIG: approved ≠ applied — es gibt KEINEN Apply-Pfad. */
  async decide({ draftId, decision, expectedVersion, note, actor } = {}) {
    const a = actorOf(actor); requireRole(a, APPROVE_ROLES);
    const cur = await this._loadDraft(draftId);
    if (cur.createdBy && a.label && cur.createdBy === a.label) {
      throw err('Vier-Augen-Prinzip: der Ersteller darf nicht selbst freigeben', 403);
    }
    const cap = getCapability(cur.capabilityId);
    const targetStatus = decision === 'approved' ? 'approved' : 'rejected';
    const next = new ConfigDraft(cur).transitionTo(targetStatus, expectedVersion);
    await this._repo.updateDraft(next.toJSON(), cur.version);
    await this._repo.createApproval(ConfigApproval.create({ draftId, decision, decidedBy: a.label, note }).toJSON());
    await this._audit(decision === 'approved' ? AUDIT_EVENTS.DRAFT_APPROVED : AUDIT_EVENTS.DRAFT_REJECTED, a, cap, next, cur.value, next.value);
    // KEIN Apply. approved bedeutet nur: freigegeben für eine SPÄTERE, separat
    // freizugebende Apply-Stufe (existiert in Slice 1 nicht).
    return this._redactDraft(next.toJSON());
  }

  // ── P_CORR_ADMIN_2 Stufe 2: serverseitige Apply-Zugriffe (nicht über HTTP roh) ──

  /** Roh-Draft (unredigierter Wert) — NUR serverseitig (Apply-Executor), nie direkt im HTTP-Body. */
  async getRawDraft(id) { return this._loadDraft(id); }

  /** Genehmiger-Info eines Drafts (für Vier-Augen-Prüfung beim Apply). */
  async getApprovalInfo(draftId) {
    const approvals = await this._repo.listApprovals(draftId);
    const approved = approvals.filter((a) => a.decision === 'approved').sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))[0];
    return { decidedBy: approved ? approved.decidedBy : null, decidedAt: approved ? approved.decidedAt : null };
  }

  // ── intern ────────────────────────────────────────────────────────────────
  async _loadDraft(id) {
    const d = await this._repo.findDraftById(id);
    if (!d) throw err('Draft nicht gefunden', 404);
    return d;
  }
  _redactDraft(d) {
    const cap = getCapability(d.capabilityId);
    return { ...d, value: cap.redact(d.value) };
  }
  async _audit(type, actor, cap, draft, before, after) {
    const event = ConfigChangeAudit.create({
      type, actor: actor.label || null, capabilityId: cap.id, targetId: draft.targetId, draftId: draft.id,
      before: before == null ? null : cap.redact(before),
      after: after == null ? null : cap.redact(after),
    });
    await this._repo.appendAudit(event.toJSON());
  }
}

module.exports = { ConfigRegistryService, EDIT_ROLES, APPROVE_ROLES };
