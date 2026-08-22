'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — Deploy-Gates (rein, fail-closed).
//
// Wird VOR jedem Infra-Schreibpfad ausgewertet. Jedes nicht erfüllte Kriterium
// → deny mit strukturiertem Code. Reihenfolge ist stabil (erster Verstoß gewinnt).
// Kein I/O — der Service reicht den vollständigen Kontext hinein.
//
// Reihenfolge: Kontext → Kill-Switch (DEPLOY_ENABLED) → Safety-Lock →
//   Run approved → Ersteller≠Genehmiger → frische Reauth (actor-gebunden) →
//   Single-flight → Replay.
// ─────────────────────────────────────────────────────────────────────────

const DEPLOY_GATE_CODES = Object.freeze({
  CONTEXT: 'E_CONTEXT',
  DISABLED: 'E_DEPLOY_DISABLED',
  SAFETY_LOCK: 'E_SAFETY_LOCK',
  NOT_APPROVED: 'E_NOT_APPROVED',
  FOUR_EYES: 'E_FOUR_EYES',
  REAUTH: 'E_REAUTH',
  ACTIVE_RUN: 'E_ACTIVE_RUN',
  REPLAY: 'E_REPLAY',
});

function deny(code, reason) { return { allowed: false, code, reason }; }
const allow = { allowed: true };

function evaluateDeployGates(ctx) {
  if (!ctx || typeof ctx !== 'object') return deny(DEPLOY_GATE_CODES.CONTEXT, 'kein Deploy-Kontext');
  const { killSwitchEnabled, safetyLocked, run, creatorLabel, approverLabel, creatorId, approverId, reauth, actor, activeRun, deployedRun } = ctx;

  if (killSwitchEnabled !== true) return deny(DEPLOY_GATE_CODES.DISABLED, 'Deploy serverseitig gesperrt (DEPLOY_ENABLED)');
  if (safetyLocked === true) return deny(DEPLOY_GATE_CODES.SAFETY_LOCK, 'globale Deploy-Sperre aktiv (failed_safe_stop) — manueller Review nötig');

  if (!run || run.status !== 'approved') return deny(DEPLOY_GATE_CODES.NOT_APPROVED, 'Deploy-Run ist nicht im Status approved');

  // Vier-Augen: der Ersteller (plan) darf nicht der Genehmiger sein. Die stabile
  // User-ID hat Vorrang (E-Mail-Case-Varianz/IdP-Wechsel darf die Prüfung nicht aushebeln);
  // Label nur als Fallback, wenn keine IDs vorliegen.
  if (creatorId && approverId) {
    if (creatorId === approverId) return deny(DEPLOY_GATE_CODES.FOUR_EYES, 'Vier-Augen verletzt: Ersteller darf nicht Genehmiger sein');
  } else if (!approverLabel || (creatorLabel && approverLabel === creatorLabel)) {
    return deny(DEPLOY_GATE_CODES.FOUR_EYES, 'Vier-Augen verletzt: Ersteller darf nicht Genehmiger sein');
  }
  if (!approverLabel && !approverId) return deny(DEPLOY_GATE_CODES.FOUR_EYES, 'Vier-Augen verletzt: kein Genehmiger');

  // Frische, actor-gebundene Re-Authentifizierung.
  if (!reauth || reauth.ok !== true) return deny(DEPLOY_GATE_CODES.REAUTH, 'frische Re-Authentifizierung erforderlich');
  if (!actor || !actor.label || (reauth.actor && reauth.actor !== actor.label)) {
    return deny(DEPLOY_GATE_CODES.REAUTH, 'Reauth gehört nicht zum anwendenden Admin');
  }

  if (activeRun) return deny(DEPLOY_GATE_CODES.ACTIVE_RUN, 'es läuft bereits ein Deploy-Run (Single-flight)');
  if (deployedRun) return deny(DEPLOY_GATE_CODES.REPLAY, 'diese Spec wurde bereits deployt (Replay-Schutz)');

  return allow;
}

module.exports = { evaluateDeployGates, DEPLOY_GATE_CODES };
