'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_1 — CorrelatorRegistryService (Slice 1).
//
// Read-only Registry-/Operations-Sicht auf die bekannten Correlatoren. Komponiert:
//   • correlatorRegistryCatalog  — Code-Allowlist (unknown = deny)
//   • CorrelationRepository       — Job-/Result-/Queue-Zahlen (read-only)
//   • ConfigRegistryService       — gebundene Capabilities, Drafts, Audit (P_CONFIG_1)
//
// ES GIBT KEINEN APPLY-/RESTART-/RELOAD-/EXEC-PFAD. Genehmigte Config bleibt
// approved, not applied. Keine Rohpayloads, keine Secrets, keine Evidence-Inhalte.
// ─────────────────────────────────────────────────────────────────────────

const { listCorrelators, getCorrelator, assertCapabilityBound } = require('./correlatorRegistryCatalog');
const { toJobSummary, toResultSummary, summarizeQueue } = require('./correlatorJobView');

class CorrelatorRegistryService {
  constructor({ correlationRepo, configService } = {}) {
    if (!correlationRepo) throw new Error('CorrelatorRegistryService: correlationRepo erforderlich');
    if (!configService) throw new Error('CorrelatorRegistryService: configService erforderlich');
    this._repo = correlationRepo;
    this._config = configService;
  }

  // ── Registry ────────────────────────────────────────────────────────────
  async listCorrelators() {
    const queue = await this._queueSummary();
    const lastActivityAt = await this._lastActivityAt();
    // Heute existiert genau ein realer Correlator; er besitzt die gesamte Pipeline.
    return listCorrelators().map((c) => ({ ...c.toJSON(), queue, lastActivityAt }));
  }

  async getCorrelator(id) {
    const c = getCorrelator(id); // unknown = 404 deny
    const queue = await this._queueSummary();
    const lastActivityAt = await this._lastActivityAt();
    return { ...c.toJSON(), queue, lastActivityAt };
  }

  // ── Jobs / Results (sichere Summaries, paginiert + bounded) ───────────────
  async listJobs(id, { status = null, limit = undefined, offset = 0 } = {}) {
    getCorrelator(id); // unknown = deny
    const jobs = await this._repo.listJobs({ status, limit, offset });
    const counts = await this._repo.countJobsByStatus();
    const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
    return { data: jobs.map(toJobSummary), total };
  }

  async listResults(id, { limit = undefined, offset = 0 } = {}) {
    getCorrelator(id); // unknown = deny
    const results = await this._repo.listResults({ limit, offset });
    return { data: results.map(toResultSummary) };
  }

  // ── Config-Sicht (gebundene + reservierte Capabilities, Drafts) ───────────
  async getConfig(id) {
    const correlator = getCorrelator(id); // unknown = deny
    // Drafts dieses Correlators in einem Zug (Ziel ist eindeutig dem Correlator zugeordnet).
    const drafts = await this._config.listDrafts({ targetId: correlator.configTargetId });
    const draftsByCap = new Map();
    for (const d of drafts) {
      if (!draftsByCap.has(d.capabilityId)) draftsByCap.set(d.capabilityId, []);
      draftsByCap.get(d.capabilityId).push(d);
    }
    const bound = correlator.configCapabilityIds.map((capId) => ({
      ...this._config.getCapability(capId),
      drafts: draftsByCap.get(capId) || [],
    }));
    // Reserviert/gesperrt: sichtbar, aber NICHT editierbar (z. B. host-/netznah).
    const reserved = this._config.listCapabilities().filter((c) => c.editable === false);
    return { bound, reserved };
  }

  // ── Audit (Config-Audit-Spur der gebundenen Capabilities; bereits redigiert) ─
  async listAudit(id, { limit = 100 } = {}) {
    const correlator = getCorrelator(id); // unknown = deny
    const perCap = await Promise.all(
      correlator.configCapabilityIds.map((capId) => this._config.listAudit({ capabilityId: capId })),
    );
    const merged = perCap.flat().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest first
    const max = Math.max(1, Math.min(Number(limit) || 100, 500));
    return { data: merged.slice(0, max) };
  }

  // ── Sichere Aktionen: correlator-skopierter Config-Lifecycle (KEIN Apply) ──
  // Erzwingt zuerst die Bindung (capability ∈ correlator.configCapabilityIds) und
  // das korrekte Ziel, delegiert dann an den ConfigRegistryService (Validierung,
  // Redaction, Vier-Augen, Audit). `decideDraft(approved)` ändert NICHTS am Betrieb.

  async createDraft(id, { capabilityId, value, actor } = {}) {
    const correlator = this._assertBoundCapability(id, capabilityId);
    return this._config.createDraft({ capabilityId, targetId: correlator.configTargetId, value, actor });
  }

  async updateDraft(id, { draftId, value, expectedVersion, actor } = {}) {
    await this._assertDraftBelongs(id, draftId);
    return this._config.updateDraftValue({ draftId, value, expectedVersion, actor });
  }

  async submitDraft(id, { draftId, expectedVersion, actor } = {}) {
    await this._assertDraftBelongs(id, draftId);
    return this._config.submitForApproval({ draftId, expectedVersion, actor });
  }

  async decideDraft(id, { draftId, decision, expectedVersion, note, actor } = {}) {
    await this._assertDraftBelongs(id, draftId);
    return this._config.decide({ draftId, decision, expectedVersion, note, actor });
  }

  // ── P_CORR_ADMIN_2 Stufe 1: separate Validierung + Apply-Plan-Vorschau ──────
  // Beide erzwingen die Correlator↔Draft-Bindung; KEIN Apply.

  async validateDraft(id, { draftId } = {}) {
    await this._assertDraftBelongs(id, draftId);
    return this._config.validateDraft(draftId);
  }

  async getApplyPlan(id, { draftId } = {}) {
    await this._assertDraftBelongs(id, draftId);
    return this._config.buildPlan(draftId);
  }

  /** Correlator existiert + Capability ist an ihn gebunden (unknown/ungebunden = deny). */
  _assertBoundCapability(id, capabilityId) {
    const correlator = getCorrelator(id);            // unknown Correlator = 404
    assertCapabilityBound(correlator, capabilityId);  // nicht gebunden = 400
    return correlator;
  }

  /** Draft existiert + gehört (über Capability-Bindung) zu genau diesem Correlator. */
  async _assertDraftBelongs(id, draftId) {
    const correlator = getCorrelator(id);             // unknown Correlator = 404
    const draft = await this._config.getDraft(draftId); // nicht gefunden = 404
    assertCapabilityBound(correlator, draft.capabilityId); // fremder Draft = 400
    return draft;
  }

  // ── intern ────────────────────────────────────────────────────────────────
  async _queueSummary() {
    const counts = await this._repo.countJobsByStatus();
    const supersededCount = await this._repo.countSupersededJobs();
    return summarizeQueue({ counts, supersededCount });
  }

  async _lastActivityAt() {
    const [latest] = await this._repo.listJobs({ limit: 1 });
    if (!latest) return null;
    return latest.completedAt || latest.startedAt || latest.createdAt || null;
  }
}

module.exports = { CorrelatorRegistryService };
