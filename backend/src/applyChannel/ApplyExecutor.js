'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 2 — ApplyExecutor.
//
// Orchestriert den kontrollierten Apply fail-closed:
//   Gates → Run(applying) → Runtime-Config-Store schreiben (versioniert) →
//   reloading → Health-Check → applied
//                    ↘ unhealthy/Fehler → rolling_back → Baseline wiederherstellen →
//                         Health ok → rolled_back
//                         Health/Write-Fehler → failed_safe_stop + globale Sperre
//
// KEIN OS/Shell/SSH/Env, KEIN Prozess-Restart — geschrieben wird ausschließlich in
// den versionierten Runtime-Config-Store (DB). Jeder Schritt erzeugt append-only Audit.
// ─────────────────────────────────────────────────────────────────────────

const { randomUUID } = require('crypto');
const logger = require('../logger');
const { AppError } = require('../errors/AppError');
const { ApplyRun } = require('./applyDomain');
const { evaluateApplyGates } = require('./applyGates');

const APPLY_AUDIT = Object.freeze({
  DENIED: 'apply.denied', STARTED: 'apply.started', WRITTEN: 'apply.written',
  APPLIED: 'apply.applied', ROLLING_BACK: 'apply.rolling_back', ROLLED_BACK: 'apply.rolled_back',
  FAILED_SAFE_STOP: 'apply.failed_safe_stop',
});

function appError(message, statusCode, code) { const e = new AppError(message, statusCode, code); e.status = statusCode; return e; }

class ApplyExecutor {
  /**
   * @param {object} deps
   * @param {object} deps.repo         Apply-Repo (Plans/Runs/RuntimeConfig/Audit/SafetyLock)
   * @param {object} deps.workerHealth { checkHealth({capabilityId,targetId,expectedVersion,timeoutMs}) → {healthy,...} }
   * @param {number} deps.healthTimeoutMs
   */
  constructor({ repo, workerHealth, healthTimeoutMs = 10000 } = {}) {
    if (!repo) throw new Error('ApplyExecutor: repo erforderlich');
    if (!workerHealth || typeof workerHealth.checkHealth !== 'function') throw new Error('ApplyExecutor: workerHealth-Adapter erforderlich');
    this._repo = repo;
    this._health = workerHealth;
    this._timeoutMs = healthTimeoutMs;
  }

  async _audit(type, { plan, run, actor, detail }) {
    await this._repo.appendApplyAudit({
      id: randomUUID(), type, actor: (actor && actor.label) || null,
      planId: plan ? plan.id : null, runId: run ? run.id : null,
      capabilityId: plan ? plan.capabilityId : null, detail: detail ?? null,
      at: new Date().toISOString(),
    });
  }

  /**
   * Führt den Apply für einen eingefrorenen Plan aus. Gibt den terminalen Run zurück
   * (applied | rolled_back | failed_safe_stop). Gate-Denial/Konflikt werfen (kein Write).
   */
  async execute({ plan, gateContext, actor, baselineValue = {}, redact = (v) => v } = {}) {
    if (!plan) throw appError('Apply: Plan fehlt', 400, 'BAD_REQUEST');

    // 1) Gates (fail-closed) — VOR jeder Wirkung.
    const gate = evaluateApplyGates(gateContext);
    if (!gate.allowed) {
      await this._audit(APPLY_AUDIT.DENIED, { plan, actor, detail: { code: gate.code, reason: gate.reason } });
      throw appError(gate.reason || 'Apply abgelehnt', 403, gate.code || 'E_APPLY_DENIED');
    }

    // 2) Run anlegen — Repo erzwingt Single-flight/Replay (Konflikt → 409).
    let run = ApplyRun.start({ planId: plan.id, startedBy: (actor && actor.label) || '' });
    try {
      await this._repo.createRun(run.toJSON());
    } catch (e) {
      if (e.code === 'ACTIVE_RUN_CONFLICT') throw appError('es läuft bereits ein Apply-Run', 409, e.code);
      if (e.code === 'PLAN_ALREADY_APPLIED') throw appError('Plan wurde bereits angewendet', 409, e.code);
      throw e;
    }
    await this._audit(APPLY_AUDIT.STARTED, { plan, run, actor });

    // Vorzustand für Rollback merken (kann null sein → Baseline ist der Rollback-Wert).
    const prev = await this._repo.getActiveRuntimeConfig(plan.capabilityId, plan.targetId);
    const rollbackValue = prev ? prev.value : baselineValue;

    try {
      // 3) Schreiben (versioniert) → reloading.
      const written = await this._repo.writeRuntimeConfig({ capabilityId: plan.capabilityId, targetId: plan.targetId, value: plan.value, appliedBy: (actor && actor.label) || '' });
      run.toReloading(written.version);
      await this._repo.updateRun(run.toJSON());
      await this._audit(APPLY_AUDIT.WRITTEN, { plan, run, actor, detail: { version: written.version, value: redact(plan.value) } });

      // 4) Health-Check.
      const health = await this._health.checkHealth({ capabilityId: plan.capabilityId, targetId: plan.targetId, expectedVersion: written.version, timeoutMs: this._timeoutMs });
      if (health && health.healthy) {
        run.toApplied(this._safeHealth(health));
        await this._repo.updateRun(run.toJSON());
        await this._audit(APPLY_AUDIT.APPLIED, { plan, run, actor, detail: { version: written.version } });
        logger.info('apply_applied', { runId: run.id, planId: plan.id, version: written.version });
        return run.toJSON();
      }
      // 5) Unhealthy → kontrollierter Rollback.
      return await this._rollback({ plan, run, actor, rollbackValue, redact, reason: (health && health.reason) || 'Health-Check fehlgeschlagen' });
    } catch (err) {
      // Schreib-/unerwarteter Fehler nach Run-Start → Rollback-Versuch.
      logger.warn('apply_error_rollback', { runId: run.id, message: err.message });
      return await this._rollback({ plan, run, actor, rollbackValue, redact, reason: err.message });
    }
  }

  async _rollback({ plan, run, actor, rollbackValue, redact, reason }) {
    // Wenn der Run noch nicht in einem Rollback-fähigen Zustand ist (z. B. Fehler vor reloading),
    // zuerst nach rolling_back überführen — defensiv über den erlaubten Pfad.
    try {
      if (run.status === 'applying') run.toRollingBack(reason);
      else if (run.status === 'reloading') run.toRollingBack(reason);
    } catch { /* bereits rolling_back */ }
    await this._repo.updateRun(run.toJSON());
    await this._audit(APPLY_AUDIT.ROLLING_BACK, { plan, run, actor, detail: { reason: this._safeReason(reason) } });

    try {
      const restored = await this._repo.writeRuntimeConfig({ capabilityId: plan.capabilityId, targetId: plan.targetId, value: rollbackValue, appliedBy: (actor && actor.label) || '' });
      const health = await this._health.checkHealth({ capabilityId: plan.capabilityId, targetId: plan.targetId, expectedVersion: restored.version, timeoutMs: this._timeoutMs });
      if (health && health.healthy) {
        run.toRolledBack();
        await this._repo.updateRun(run.toJSON());
        await this._audit(APPLY_AUDIT.ROLLED_BACK, { plan, run, actor, detail: { version: restored.version, value: redact(rollbackValue) } });
        logger.warn('apply_rolled_back', { runId: run.id, planId: plan.id });
        return run.toJSON();
      }
      return await this._safeStop({ plan, run, actor, reason: 'Rollback wiederhergestellt, aber Worker bleibt ungesund' });
    } catch (err) {
      return await this._safeStop({ plan, run, actor, reason: `Rollback-Schreiben fehlgeschlagen: ${err.message}` });
    }
  }

  async _safeStop({ plan, run, actor, reason }) {
    try { run.toFailedSafeStop(reason); } catch { /* terminal */ }
    await this._repo.updateRun(run.toJSON());
    await this._repo.setSafetyLock(true, this._safeReason(reason)); // globale Apply-Sperre bis manueller Review
    await this._audit(APPLY_AUDIT.FAILED_SAFE_STOP, { plan, run, actor, detail: { reason: this._safeReason(reason) } });
    logger.error('apply_failed_safe_stop', { runId: run.id, planId: plan.id, reason: this._safeReason(reason) });
    return run.toJSON();
  }

  // Sanitierte, gedeckelte Fehlertexte/Health-Felder fürs Audit (kein Stack/Rohinhalt).
  _safeReason(reason) {
    const t = String(reason || '').replace(/\s+/g, ' ').trim();
    return t.length > 200 ? `${t.slice(0, 199)}…` : t;
  }
  _safeHealth(health) {
    if (!health || typeof health !== 'object') return null;
    return { healthy: !!health.healthy, configVersion: health.configVersion ?? null, heartbeatFresh: !!health.heartbeatFresh, queueOk: !!health.queueOk };
  }
}

module.exports = { ApplyExecutor, APPLY_AUDIT };
