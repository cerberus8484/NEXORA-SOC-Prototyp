'use strict';

const config = require('../config');

/**
 * guardrailConfig — die EINZIGE Quelle der Wahrheit für die KI-Safety-Floor-Schwellen.
 *
 * Diese Konstanten wurden aus OllamaLlmProvider (`_enforceEvidenceFloor`,
 * `_enforceOperationalErrorFloor`) extrahiert, damit die KI-Settings-Seite die
 * ECHTEN aktiven Werte read-only anzeigen kann — ohne Drift zwischen Anzeige und
 * Verhalten. Der Provider importiert dieselben Konstanten; ändert sich hier ein
 * Wert, ändert sich beides synchron.
 *
 * WICHTIG: Reine Konstanten + ein beschreibendes Objekt. KEIN Eingriff in die
 * Floor-Logik — die bleibt im Provider. Hier wird nur abgebildet.
 */

// ── Evidence-Floor (VirusTotal-Malicious-Funde überstimmen schwaches Modell) ──
// VT-Malicious-Schwellen: ab wann wird das Verdict deterministisch angehoben.
const EVIDENCE_FLOOR = Object.freeze({
  // ≥ confirmedVtMin malicious Engines → Verdict mind. "confirmed_incident".
  confirmedVtMin: 5,
  // ≥ suspiciousVtMin malicious Engine(s) → Verdict mind. "suspicious".
  suspiciousVtMin: 1,
  // Confidence-Untergrenzen, auf die beim jeweiligen Override mindestens angehoben wird.
  confirmedConfidenceFloor: 0.9,
  suspiciousConfidenceFloor: 0.7,
});

// ── Benign-Floor (AV/Scanner-Betriebsfehler ohne Fund → false_positive) ──────
const BENIGN_FLOOR = Object.freeze({
  // Confidence-Untergrenze beim Benign-Override.
  confidenceFloor: 0.8,
});

/**
 * Baut das read-only Transparenz-Objekt für GET /v1/agent/guardrails.
 * Spiegelt die echten aktiven Guardrail-Werte — kein Eingriff.
 *
 * @returns {{
 *   evidenceFloor: { enabled: boolean, confirmedVtMin: number, suspiciousVtMin: number,
 *                    confirmedConfidenceFloor: number, suspiciousConfidenceFloor: number },
 *   benignFloor: { enabled: boolean, confidenceFloor: number },
 *   antiHallucination: { enabled: boolean },
 *   humanInTheLoop: { allSuggestionsRequireApproval: boolean, autonomyEnabled: boolean }
 * }}
 */
function describeGuardrails() {
  return {
    evidenceFloor: {
      enabled: true, // deterministischer Floor ist fest verdrahtet (kein Abschalt-Flag)
      confirmedVtMin: EVIDENCE_FLOOR.confirmedVtMin,
      suspiciousVtMin: EVIDENCE_FLOOR.suspiciousVtMin,
      confirmedConfidenceFloor: EVIDENCE_FLOOR.confirmedConfidenceFloor,
      suspiciousConfidenceFloor: EVIDENCE_FLOOR.suspiciousConfidenceFloor,
    },
    benignFloor: {
      enabled: true,
      confidenceFloor: BENIGN_FLOOR.confidenceFloor,
    },
    antiHallucination: {
      // Schema-Platzhalter-Filter + "confirmed_facts nur belegt"-Regeln im Prompt/Parser.
      enabled: true,
    },
    humanInTheLoop: {
      // Jeder Vorschlag landet als 'pending' und braucht menschliche Freigabe (ADR-016).
      allSuggestionsRequireApproval: true,
      autonomyEnabled: !!(config.autonomy && config.autonomy.enabled),
    },
  };
}

module.exports = { EVIDENCE_FLOOR, BENIGN_FLOOR, describeGuardrails };
