'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 2 — CorrelatorApplyService.
//
// Verbindet Correlator-Bindung + Config-Lifecycle + Apply-Domain + Executor:
//   freezePlan(): genehmigten Draft zu einem immutablen Apply-Plan einfrieren.
//   apply():      Gates → Executor (Store-Write/Health/Rollback/Safe-Stop).
//
// Erzwingt: Correlator existiert · Capability gebunden · apply-eligible · Draft
// approved. KEIN Apply für etwas anderes als die zwei Worker-Parameter.
// ─────────────────────────────────────────────────────────────────────────

const { AppError } = require('../errors/AppError');
const { getCorrelator, assertCapabilityBound } = require('../correlatorRegistry/correlatorRegistryCatalog');
const { getCapability, isApplyEligible, applyChannelEnabled } = require('../configRegistry/configCapabilityCatalog');
const { defaultsOf } = require('../configRegistry/applyPlan');
const { ApplyPlan } = require('./applyDomain');

function appError(message, statusCode, code) { const e = new AppError(message, statusCode, code); e.status = statusCode; return e; }

class CorrelatorApplyService {
  constructor({ applyRepo, configService, executor, authService, workerStatusRepo = null, workerId = 'correlation-worker', heartbeatMaxAgeMs = 30000 } = {}) {
    if (!applyRepo) throw new Error('CorrelatorApplyService: applyRepo erforderlich');
    if (!configService) throw new Error('CorrelatorApplyService: configService erforderlich');
    if (!executor) throw new Error('CorrelatorApplyService: executor erforderlich');
    if (!authService) throw new Error('CorrelatorApplyService: authService erforderlich');
    this._repo = applyRepo; this._config = configService; this._exec = executor; this._auth = authService;
    this._workerStatusRepo = workerStatusRepo; this._workerId = workerId; this._heartbeatMaxAgeMs = heartbeatMaxAgeMs;
  }

  /**
   * Read-only Live-Health-Sicht des Correlation-Workers für die UI. EHRLICH: zeigt
   * Heartbeat-Frische, übernommene Config-Versionen, Queue-Zustand + Apply-Readiness.
   * Apply-Readiness ist fail-closed — blockiert, solange nicht alle Live-Signale + der
   * Kill-Switch vorhanden sind. (Das ersetzt KEINE Apply-Gates; nur eine Anzeige.)
   */
  async getWorkerHealth(correlatorId) {
    getCorrelator(correlatorId); // unknown = 404
    const killSwitchEnabled = applyChannelEnabled();
    const st = this._workerStatusRepo ? await this._workerStatusRepo.get(this._workerId) : null;
    if (!st || !st.lastHeartbeatAt) {
      return { workerId: this._workerId, present: false, heartbeatFresh: false, ageMs: null, adoptedConfigVersions: {}, queueProcessingState: 'unknown', queueOk: false, lastJobOutcome: null, killSwitchEnabled, applyReady: false, reasons: ['kein Worker-Status / kein Heartbeat'] };
    }
    const ageMs = Date.now() - new Date(st.lastHeartbeatAt).getTime();
    const heartbeatFresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= this._heartbeatMaxAgeMs;
    const queueOk = st.queueProcessingState === 'processing' || st.queueProcessingState === 'idle';
    const reasons = [];
    if (!heartbeatFresh) reasons.push('Heartbeat veraltet oder fehlt');
    if (!queueOk) reasons.push(`Queue-Zustand nicht gesund (${st.queueProcessingState})`);
    if (!killSwitchEnabled) reasons.push('Apply serverseitig gesperrt (CONFIG_APPLY_ENABLED=false)');
    return {
      workerId: this._workerId, present: true,
      lastHeartbeatAt: st.lastHeartbeatAt, ageMs, heartbeatFresh,
      adoptedConfigVersions: st.adoptedConfigVersions || {},
      queueProcessingState: st.queueProcessingState, queueOk,
      lastJobOutcome: st.lastJobOutcome || null,
      killSwitchEnabled, applyReady: heartbeatFresh && queueOk && killSwitchEnabled, reasons,
    };
  }

  /** Genehmigten Draft zu einem immutablen Apply-Plan einfrieren (idempotent je Hash). */
  async freezePlan(correlatorId, draftId, actor = {}) {
    const { correlator, draft, cap } = await this._loadBound(correlatorId, draftId);
    if (draft.status !== 'approved') throw appError('nur ein genehmigter Draft kann eingefroren werden', 409, 'CONFLICT');
    if (!isApplyEligible(cap.id)) throw appError(`Capability '${cap.id}' ist nicht apply-eligible`, 400, 'BAD_REQUEST');

    const plan = ApplyPlan.create({ draftId: draft.id, capabilityId: cap.id, targetId: draft.targetId, value: draft.value, expectedVersion: draft.version, createdBy: actor.label || '' });
    const existing = await this._repo.findPlanByHash(plan.planHash);
    if (existing) return this._redactPlan(existing, cap);

    await this._repo.createPlan(plan.toJSON());
    await this._repo.appendApplyAudit({ id: require('crypto').randomUUID(), type: 'apply.plan_frozen', actor: actor.label || null, planId: plan.id, runId: null, capabilityId: cap.id, detail: { expectedVersion: draft.version }, at: new Date().toISOString() });
    return this._redactPlan(plan.toJSON(), cap);
  }

  /** Kontrollierter Apply eines eingefrorenen Plans. Gates + Executor. KEIN OS/Shell. */
  async apply(correlatorId, planId, { actor = {}, reauthToken } = {}) {
    const correlator = getCorrelator(correlatorId);               // unknown = 404
    const plan = await this._repo.findPlanById(planId);
    if (!plan) throw appError('Apply-Plan nicht gefunden', 404, 'NOT_FOUND');
    assertCapabilityBound(correlator, plan.capabilityId);          // nicht gebunden = 400
    const cap = getCapability(plan.capabilityId);

    const draft = await this._config.getRawDraft(plan.draftId);    // 404 wenn weg
    const approval = await this._config.getApprovalInfo(plan.draftId);
    const ra = this._auth.verifyApplyReauth(reauthToken, actor.id);
    const lock = await this._repo.getSafetyLock();

    const gateContext = {
      killSwitchEnabled: applyChannelEnabled(),
      safetyLocked: !!lock.locked,
      capabilityId: plan.capabilityId,
      draft: { status: draft.status, createdBy: draft.createdBy, value: draft.value, version: draft.version },
      approverLabel: approval.decidedBy,
      plan,
      reauth: { ok: !!ra.ok, actor: ra.ok ? actor.label : null },
      actor,
      activeRun: await this._repo.findActiveRun(),
      appliedRun: await this._repo.findAppliedRunByPlan(plan.id),
    };

    return this._exec.execute({
      plan, gateContext, actor,
      baselineValue: defaultsOf(cap),
      redact: (v) => cap.redact(v),
    });
  }

  async getRun(runId) {
    const run = await this._repo.findRunById(runId);
    if (!run) throw appError('Apply-Run nicht gefunden', 404, 'NOT_FOUND');
    return run;
  }

  async listAudit({ planId, runId } = {}) { return this._repo.listApplyAudit({ planId, runId }); }

  // ── intern ──
  async _loadBound(correlatorId, draftId) {
    const correlator = getCorrelator(correlatorId);               // unknown = 404
    const draft = await this._config.getRawDraft(draftId);        // 404
    assertCapabilityBound(correlator, draft.capabilityId);        // nicht gebunden = 400
    const cap = getCapability(draft.capabilityId);
    return { correlator, draft, cap };
  }
  _redactPlan(plan, cap) { return { ...plan, value: cap.redact(plan.value) }; }
}

module.exports = { CorrelatorApplyService };
