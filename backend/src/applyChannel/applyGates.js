'use strict';

// ─────────────────────────────────────────────────────────────────────────
// P_CORR_ADMIN_2 Stufe 2 — Apply-Gates (rein, fail-closed).
//
// Wird VOR jedem Schreibpfad ausgewertet. Jedes nicht erfüllte/abweichende
// Kriterium → deny mit strukturiertem Code. Reihenfolge ist stabil (erster
// Verstoß gewinnt). Kein I/O — Aufrufer reicht den vollständigen Kontext hinein.
//
// Reihenfolge: Kill-Switch → Safety-Lock → Eligibility → Draft approved →
//   planHash/expectedVersion (Anti-TOCTOU) → Ersteller≠Approver →
//   frische Reauth (Actor-gebunden) → Single-flight → Replay.
// ─────────────────────────────────────────────────────────────────────────

const { isApplyEligible } = require('../configRegistry/configCapabilityCatalog');
const { computePlanHash } = require('./applyDomain');

const GATE_CODES = Object.freeze({
  KILL_SWITCH: 'E_KILL_SWITCH',
  SAFETY_LOCK: 'E_SAFETY_LOCK',
  NOT_ELIGIBLE: 'E_NOT_ELIGIBLE',
  DRAFT_NOT_APPROVED: 'E_DRAFT_NOT_APPROVED',
  PLAN_MISMATCH: 'E_PLAN_MISMATCH',
  FOUR_EYES: 'E_FOUR_EYES',
  REAUTH: 'E_REAUTH',
  ACTIVE_RUN: 'E_ACTIVE_RUN',
  REPLAY: 'E_REPLAY',
  CONTEXT: 'E_CONTEXT',
});

function deny(code, reason) { return { allowed: false, code, reason }; }
const allow = { allowed: true };

function evaluateApplyGates(ctx) {
  // Fail-closed: ohne vollständigen Kontext kein Apply.
  if (!ctx || typeof ctx !== 'object') return deny(GATE_CODES.CONTEXT, 'kein Apply-Kontext');
  const { killSwitchEnabled, safetyLocked, capabilityId, draft, approverLabel, plan, reauth, actor, activeRun, appliedRun } = ctx;

  if (killSwitchEnabled !== true) return deny(GATE_CODES.KILL_SWITCH, 'Apply serverseitig gesperrt (CONFIG_APPLY_ENABLED)');
  if (safetyLocked === true) return deny(GATE_CODES.SAFETY_LOCK, 'globale Apply-Sperre aktiv (failed_safe_stop) — manueller Review nötig');

  if (!capabilityId || !isApplyEligible(capabilityId)) return deny(GATE_CODES.NOT_ELIGIBLE, 'Capability ist nicht apply-eligible');

  if (!draft || draft.status !== 'approved') return deny(GATE_CODES.DRAFT_NOT_APPROVED, 'Draft ist nicht im Status approved');

  if (!plan || !plan.planHash) return deny(GATE_CODES.PLAN_MISMATCH, 'kein gültiger Apply-Plan');
  // Anti-TOCTOU: aktuelle Draft-Revision muss exakt dem eingefrorenen Plan entsprechen.
  if (Number(draft.version) !== Number(plan.expectedVersion)) return deny(GATE_CODES.PLAN_MISMATCH, 'Draft-Version weicht vom Plan ab (TOCTOU)');
  const recomputed = computePlanHash({ capabilityId, targetId: plan.targetId, value: draft.value, expectedVersion: plan.expectedVersion });
  if (recomputed !== plan.planHash) return deny(GATE_CODES.PLAN_MISMATCH, 'planHash stimmt nicht mit aktuellem Draft überein');

  // Vier-Augen: der Ersteller des Drafts darf nicht der Genehmiger sein.
  if (!approverLabel || (draft.createdBy && approverLabel === draft.createdBy)) {
    return deny(GATE_CODES.FOUR_EYES, 'Vier-Augen verletzt: Ersteller darf nicht Genehmiger sein');
  }

  // Frische, actor-gebundene Re-Authentifizierung.
  if (!reauth || reauth.ok !== true) return deny(GATE_CODES.REAUTH, 'frische Re-Authentifizierung erforderlich');
  if (!actor || !actor.label || reauth.actor !== actor.label) return deny(GATE_CODES.REAUTH, 'Reauth gehört nicht zum anwendenden Admin');

  if (activeRun) return deny(GATE_CODES.ACTIVE_RUN, 'es läuft bereits ein Apply-Run (Single-flight)');
  if (appliedRun) return deny(GATE_CODES.REPLAY, 'dieser Plan wurde bereits angewendet (Replay-Schutz)');

  return allow;
}

module.exports = { evaluateApplyGates, GATE_CODES };
