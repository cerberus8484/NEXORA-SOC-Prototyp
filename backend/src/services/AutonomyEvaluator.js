'use strict';

/**
 * AutonomyEvaluator — Reiner Entscheid-Evaluator (keine Seiteneffekte)
 *
 * decide({ policy, actionClass, verdict, confidence, evidenceBacked,
 *          globalEnabled, recentActionCount }) → { decision, reasons }
 *
 * decision: 'advise' | 'act'
 * reasons:  string[] — immer befüllt, kein stiller Pfad
 *
 * Default-Deny: Alle Bedingungen müssen erfüllt sein für 'act'.
 * Harte Decken: host_response und external_comms ergeben NIEMALS 'act'.
 *
 * KRITISCH: Diese Funktion ist NICHT in AgentService oder einen Live-Aktionspfad
 * eingehängt. Sie ist ein eigenständiges, getestetes Gate.
 *
 * ADR-016: Autonomie-Fundament, Default-Advisory, Default-Deny.
 */

const { CEILINGS, VERDICT_RANK, MODE_RANK } = require('../domain/AutonomyPolicy');

/**
 * Berechnet den effektiven Mode unter Berücksichtigung der Decke für die Klasse.
 * effectiveMode = min(policy.mode, CEILING[actionClass]) nach Mode-Rang.
 */
function _effectiveMode(policyMode, actionClass) {
  const ceiling = CEILINGS[actionClass] || 'advisory';
  const policyRank  = MODE_RANK[policyMode]  ?? 0;
  const ceilingRank = MODE_RANK[ceiling]      ?? 0;
  // Nimmt das Minimum (restriktivere Seite gewinnt)
  const effectiveRank = Math.min(policyRank, ceilingRank);
  // Zurück in Modus-String
  return Object.keys(MODE_RANK).find((k) => MODE_RANK[k] === effectiveRank) || 'advisory';
}

/**
 * Entscheidet ob eine autonome Aktion durchgeführt werden darf.
 *
 * @param {object} opts
 * @param {object|null} opts.policy            - AutonomyPolicy-Objekt (oder null)
 * @param {string}      opts.actionClass       - Die Aktionsklasse
 * @param {string}      opts.verdict           - KI-Verdict
 * @param {number}      opts.confidence        - Confidence 0..1
 * @param {boolean}     opts.evidenceBacked    - Hat deterministische Evidence-Absicherung
 * @param {boolean}     opts.globalEnabled     - ENV AUTONOMY_ENABLED
 * @param {number}      opts.recentActionCount - Anzahl autonomer Aktionen in letzter Stunde
 * @returns {{ decision: 'advise'|'act', reasons: string[] }}
 */
function decide({
  policy,
  actionClass,
  verdict,
  confidence,
  evidenceBacked,
  globalEnabled,
  recentActionCount = 0,
} = {}) {
  const reasons = [];

  // ── 1. Kill-Switch (globalEnabled) ────────────────────────────────────────
  if (globalEnabled !== true) {
    reasons.push('kill_switch: AUTONOMY_ENABLED ist nicht aktiv (Default false)');
    return { decision: 'advise', reasons };
  }

  // ── 2. Policy fehlt oder ist deaktiviert ──────────────────────────────────
  if (!policy) {
    reasons.push('policy: Keine Policy für diese Aktionsklasse konfiguriert (Default-Deny)');
    return { decision: 'advise', reasons };
  }
  if (policy.enabled !== true) {
    reasons.push('policy: Policy ist deaktiviert (enabled=false)');
    return { decision: 'advise', reasons };
  }

  // ── 3. Decke (CEILING) greift — effectiveMode muss autonomous sein ────────
  const effectiveMode = _effectiveMode(policy.mode, actionClass);
  if (effectiveMode !== 'autonomous') {
    reasons.push(
      `ceiling: effectiveMode='${effectiveMode}' für actionClass='${actionClass}' ` +
      `(policy.mode='${policy.mode}', ceiling='${CEILINGS[actionClass]}'). ` +
      `Nur 'autonomous' erlaubt 'act'.`
    );
    return { decision: 'advise', reasons };
  }

  // ── 4. Evidence-Floor (Autonomie sitzt auf deterministischer Evidence) ────
  if (policy.requireEvidenceFloor && !evidenceBacked) {
    reasons.push(
      'evidence_floor: requireEvidenceFloor=true aber evidenceBacked=false. ' +
      'Autonomie erfordert deterministisch abgesichertes Verdict (ADR-014/016).'
    );
    return { decision: 'advise', reasons };
  }

  // ── 5. Verdict-Rang ───────────────────────────────────────────────────────
  const verdictRank    = VERDICT_RANK[verdict]           ?? -1;
  const minVerdictRank = VERDICT_RANK[policy.minVerdict] ?? 999;
  if (verdictRank < minVerdictRank) {
    reasons.push(
      `verdict: verdict='${verdict}' (Rang ${verdictRank}) < ` +
      `minVerdict='${policy.minVerdict}' (Rang ${minVerdictRank})`
    );
    return { decision: 'advise', reasons };
  }

  // ── 6. Confidence ────────────────────────────────────────────────────────
  const conf = typeof confidence === 'number' ? confidence : 0;
  if (conf < policy.minConfidence) {
    reasons.push(
      `confidence: ${conf} < minConfidence ${policy.minConfidence}`
    );
    return { decision: 'advise', reasons };
  }

  // ── 7. Rate-Limit / Circuit-Breaker ──────────────────────────────────────
  if (policy.maxPerHour > 0 && recentActionCount >= policy.maxPerHour) {
    reasons.push(
      `rate_limit: recentActionCount=${recentActionCount} >= maxPerHour=${policy.maxPerHour}. ` +
      'Circuit-Breaker greift.'
    );
    return { decision: 'advise', reasons };
  }

  // ── Alle Bedingungen erfüllt → act ────────────────────────────────────────
  reasons.push(
    `act: Alle Bedingungen erfüllt — ` +
    `actionClass='${actionClass}', effectiveMode='${effectiveMode}', ` +
    `verdict='${verdict}', confidence=${conf}, evidenceBacked=${evidenceBacked}`
  );
  return { decision: 'act', reasons };
}

module.exports = { decide };
