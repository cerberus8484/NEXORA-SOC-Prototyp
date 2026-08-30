'use strict';

/**
 * UseCaseQualityValidator
 *
 * Prüft einen UseCaseDraft gegen ein SOC-Quality-Gate (Tier 1–3 Standard).
 * Reines Modul — keine DB, kein Netz, keine Seiteneffekte.
 *
 * Kontrakt (Plain-Object, camelCase):
 *   UseCaseDraft = {
 *     title, sourceType, sourceId, status, description, detectionGoal,
 *     dataSources: string[],
 *     requiredFields: string[],
 *     detectionLogic: { language, queryOrRule, explanation },
 *     mitre: [{ tactic, technique }],
 *     severity: 'low'|'medium'|'high'|'critical',
 *     confidence: number (0–100),
 *     falsePositiveRisks: string[],
 *     testCases: [{ name, type: 'true_positive'|'false_positive', event, expectedResult }],
 *     recommendedActions: string[],
 *     playbookSteps: string[]
 *   }
 *
 * Ausgabe: { checks: CheckResult[], passed: boolean, score: number, blocking: string[] }
 *   CheckResult: { id, label, status: 'pass'|'warn'|'fail', detail }
 *
 * passed = false wenn mindestens ein Check 'fail' hat.
 * 'warn' blockt NICHT (warn = brauchbar aber verbesserungswürdig).
 * score = Anteil 'pass' über alle Checks (0–100, gerundet).
 */

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 100;

/**
 * @param {string} id
 * @param {string} label
 * @param {'pass'|'warn'|'fail'} status
 * @param {string} detail
 * @returns {{ id: string, label: string, status: string, detail: string }}
 */
function makeCheck(id, label, status, detail) {
  return { id, label, status, detail };
}

/**
 * Gibt true zurück wenn val ein nicht-leeres Array ist.
 * @param {unknown} val
 * @returns {boolean}
 */
function isNonEmptyArray(val) {
  return Array.isArray(val) && val.length > 0;
}

/**
 * Gibt true zurück wenn val ein nicht-leerer String ist.
 * @param {unknown} val
 * @returns {boolean}
 */
function isNonEmptyString(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

// ─── Einzelne Check-Funktionen ────────────────────────────────────────────────

/**
 * CHECK: Titel vorhanden
 */
function checkTitle(draft) {
  const id = 'title';
  const label = 'Titel vorhanden';
  if (isNonEmptyString(draft.title)) {
    return makeCheck(id, label, 'pass', `Titel: "${draft.title}"`);
  }
  return makeCheck(id, label, 'fail', 'Kein Titel angegeben — ein Use Case braucht einen eindeutigen Bezeichner.');
}

/**
 * CHECK: Beschreibung + Erkennungsziel vorhanden
 */
function checkDescription(draft) {
  const id = 'description';
  const label = 'Beschreibung und Erkennungsziel';
  const hasDesc = isNonEmptyString(draft.description);
  const hasGoal = isNonEmptyString(draft.detectionGoal);
  if (hasDesc && hasGoal) {
    return makeCheck(id, label, 'pass', 'Beschreibung und Erkennungsziel sind vorhanden.');
  }
  if (hasDesc && !hasGoal) {
    return makeCheck(id, label, 'fail', 'detectionGoal fehlt — was soll diese Regel erkennen?');
  }
  if (!hasDesc && hasGoal) {
    return makeCheck(id, label, 'fail', 'description fehlt — Kontext für Tier-1-Analyst nicht erkennbar.');
  }
  return makeCheck(id, label, 'fail', 'description und detectionGoal fehlen — Pflichtfelder für jeden Use Case.');
}

/**
 * CHECK: Mindestens eine Datenquelle (dataSources nicht leer)
 */
function checkDataSources(draft) {
  const id = 'data_sources';
  const label = 'Datenquellen angegeben';
  if (isNonEmptyArray(draft.dataSources)) {
    const count = draft.dataSources.length;
    return makeCheck(id, label, 'pass', `${count} Datenquelle(n) definiert.`);
  }
  return makeCheck(id, label, 'fail', 'dataSources ist leer — ohne Datenquelle ist die Detection nicht deploybar.');
}

/**
 * CHECK: MITRE ATT&CK Mapping (≥1 Eintrag)
 */
function checkMitreMapping(draft) {
  const id = 'mitre_mapping';
  const label = 'MITRE ATT&CK Mapping vorhanden';
  if (!isNonEmptyArray(draft.mitre)) {
    return makeCheck(id, label, 'fail', 'Kein MITRE-Mapping — ohne Tactic/Technique ist kein Kontext für Threat Intelligence möglich.');
  }
  const validEntries = draft.mitre.filter(
    (m) => m && isNonEmptyString(m.tactic) && isNonEmptyString(m.technique)
  );
  if (validEntries.length === 0) {
    return makeCheck(id, label, 'fail', 'MITRE-Einträge vorhanden, aber tactic oder technique fehlen bei allen Einträgen.');
  }
  return makeCheck(id, label, 'pass', `${validEntries.length} MITRE-Eintrag/Einträge mit Tactic + Technique.`);
}

/**
 * CHECK: False-Positive-Risiken dokumentiert (≥1)
 */
function checkFalsePositiveRisks(draft) {
  const id = 'fp_risks';
  const label = 'False-Positive-Risiken dokumentiert';
  if (isNonEmptyArray(draft.falsePositiveRisks)) {
    return makeCheck(id, label, 'pass', `${draft.falsePositiveRisks.length} FP-Risiko(en) dokumentiert.`);
  }
  return makeCheck(id, label, 'fail', 'falsePositiveRisks ist leer — ohne FP-Analyse ist die Detection nicht produktionsreif (Tier-1-Standard).');
}

/**
 * CHECK: Testfälle vorhanden (≥1 TP; fehlende FP → warn)
 */
function checkTestCases(draft) {
  const id = 'test_cases';
  const label = 'Testfälle (TP + FP)';
  if (!isNonEmptyArray(draft.testCases)) {
    return makeCheck(id, label, 'fail', 'Keine Testfälle definiert — TP und FP-Tests sind Pflicht für VALIDATED-Status.');
  }

  const tpCases = draft.testCases.filter((tc) => tc && tc.type === 'true_positive');
  const fpCases = draft.testCases.filter((tc) => tc && tc.type === 'false_positive');

  if (tpCases.length === 0) {
    return makeCheck(id, label, 'fail', 'Kein True-Positive-Testfall — ohne TP-Beweis ist die Detection unvalidiert.');
  }

  if (fpCases.length === 0) {
    return makeCheck(
      id,
      label,
      'warn',
      `${tpCases.length} TP-Testfall/fälle vorhanden, aber kein False-Positive-Testfall. FP-Tests empfohlen (SOC Tier-2 Standard).`
    );
  }

  return makeCheck(
    id,
    label,
    'pass',
    `${tpCases.length} TP + ${fpCases.length} FP Testfall/fälle definiert.`
  );
}

/**
 * CHECK: Severity (gültiger Wert)
 */
function checkSeverity(draft) {
  const id = 'severity';
  const label = 'Severity-Level gültig';
  if (VALID_SEVERITIES.has(draft.severity)) {
    return makeCheck(id, label, 'pass', `Severity: "${draft.severity}"`);
  }
  const got = draft.severity !== undefined && draft.severity !== null
    ? `"${draft.severity}"`
    : 'nicht gesetzt';
  return makeCheck(
    id,
    label,
    'fail',
    `Ungültige Severity ${got}. Erlaubt: low | medium | high | critical.`
  );
}

/**
 * CHECK: Confidence Score (0–100, Zahl)
 */
function checkConfidence(draft) {
  const id = 'confidence';
  const label = 'Confidence Score gültig (0–100)';
  const c = draft.confidence;
  if (typeof c === 'number' && Number.isFinite(c) && c >= CONFIDENCE_MIN && c <= CONFIDENCE_MAX) {
    return makeCheck(id, label, 'pass', `Confidence: ${c}`);
  }
  const got = c !== undefined && c !== null ? `"${c}"` : 'nicht gesetzt';
  return makeCheck(
    id,
    label,
    'fail',
    `Ungültiger Confidence-Wert ${got}. Muss eine Zahl zwischen 0 und 100 sein.`
  );
}

/**
 * CHECK: Detection Logic (queryOrRule nicht leer)
 */
function checkDetectionLogic(draft) {
  const id = 'detection_logic';
  const label = 'Detection Logic vorhanden (queryOrRule)';
  const logic = draft.detectionLogic;
  if (!logic || typeof logic !== 'object') {
    return makeCheck(id, label, 'fail', 'detectionLogic fehlt — ohne Query/Regel ist die Detection nicht deploybar.');
  }
  if (!isNonEmptyString(logic.queryOrRule)) {
    return makeCheck(id, label, 'fail', 'detectionLogic.queryOrRule ist leer — die eigentliche Detektionsregel fehlt.');
  }
  const langHint = isNonEmptyString(logic.language) ? ` (Sprache: ${logic.language})` : '';
  return makeCheck(id, label, 'pass', `Detection Logic vorhanden${langHint}.`);
}

/**
 * CHECK: Empfohlene Aktionen vorhanden (warn wenn leer, kein fail)
 */
function checkRecommendedActions(draft) {
  const id = 'recommended_actions';
  const label = 'Empfohlene Aktionen / Playbook';
  const hasActions = isNonEmptyArray(draft.recommendedActions);
  const hasPlaybook = isNonEmptyArray(draft.playbookSteps);

  if (hasActions || hasPlaybook) {
    const parts = [];
    if (hasActions) parts.push(`${draft.recommendedActions.length} Aktion(en)`);
    if (hasPlaybook) parts.push(`${draft.playbookSteps.length} Playbook-Schritt(e)`);
    return makeCheck(id, label, 'pass', parts.join(', ') + ' definiert.');
  }

  return makeCheck(
    id,
    label,
    'warn',
    'recommendedActions und playbookSteps sind leer. Tier-1-Analysten benötigen Handlungsanweisungen.'
  );
}

// ─── Haupt-Validator ──────────────────────────────────────────────────────────

/**
 * Prüft einen UseCaseDraft gegen das SOC Quality-Gate.
 *
 * @param {object} draft - Der zu prüfende UseCaseDraft (Plain Object)
 * @returns {{ checks: object[], passed: boolean, score: number, blocking: string[] }}
 */
function validateUseCaseDraft(draft) {
  // Defensiv: falls kein Objekt übergeben wird → alle Checks schlagen fehl
  const d = (draft !== null && draft !== undefined && typeof draft === 'object') ? draft : {};

  const checks = [
    checkTitle(d),
    checkDescription(d),
    checkDataSources(d),
    checkMitreMapping(d),
    checkFalsePositiveRisks(d),
    checkTestCases(d),
    checkSeverity(d),
    checkConfidence(d),
    checkDetectionLogic(d),
    checkRecommendedActions(d),
  ];

  const failingChecks = checks.filter((c) => c.status === 'fail');
  const passingChecks = checks.filter((c) => c.status === 'pass');

  const passed = failingChecks.length === 0;
  const score = Math.round((passingChecks.length / checks.length) * 100);
  const blocking = failingChecks.map((c) => c.id);

  return { checks, passed, score, blocking };
}

module.exports = { validateUseCaseDraft };
