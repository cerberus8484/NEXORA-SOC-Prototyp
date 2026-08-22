'use strict';

const { validateUseCaseDraft } = require('../../src/services/UseCaseQualityValidator');

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** Vollständiger, produktionsreifer Draft → passed: true */
const FULL_VALID_DRAFT = {
  title: 'Suspicious PowerShell Encoded Command',
  sourceType: 'wazuh',
  sourceId: 'rule-100001',
  status: 'draft',
  description: 'Erkennt PowerShell-Ausführungen mit Base64-encodierten Befehlen, typisch für Obfuscation-Techniken.',
  detectionGoal: 'Erkennung von PowerShell-Obfuscation via -EncodedCommand als Indiz für Initial Access oder Execution.',
  dataSources: ['Windows Security Event Log', 'Sysmon Event 1'],
  requiredFields: ['process.name', 'process.command_line'],
  detectionLogic: {
    language: 'sigma',
    queryOrRule: 'process.name: powershell.exe AND process.command_line: *-enc*',
    explanation: 'Matched wenn powershell.exe mit -enc/-EncodedCommand aufgerufen wird.',
  },
  mitre: [
    { tactic: 'Execution', technique: 'T1059.001' },
    { tactic: 'Defense Evasion', technique: 'T1027' },
  ],
  severity: 'high',
  confidence: 75,
  falsePositiveRisks: [
    'Legitimate IT-Automation-Skripte (z.B. SCCM, Intune)',
    'Administratoren, die encoded PS-Commands für Deployment nutzen',
  ],
  testCases: [
    {
      name: 'TP: Encoded Mimikatz download',
      type: 'true_positive',
      event: { process: { name: 'powershell.exe', command_line: 'powershell.exe -enc aQBlAHgA' } },
      expectedResult: 'Alert ausgelöst',
    },
    {
      name: 'FP: SCCM Deployment Script',
      type: 'false_positive',
      event: { process: { name: 'powershell.exe', command_line: 'powershell.exe -enc U0NDTQ==' } },
      expectedResult: 'Whitelist-Ausnahme via FP-Regel',
    },
  ],
  recommendedActions: ['Alert eskalieren', 'Prozessbaum analysieren', 'Hash auf VT prüfen'],
  playbookSteps: ['1. Elternprozess prüfen', '2. Command-Line dekodieren', '3. Network-Connections prüfen'],
};

/** Hilfsfunktion: Draft mit überschriebenen Feldern */
function draftWith(overrides) {
  return { ...FULL_VALID_DRAFT, ...overrides };
}

// ─── Hilfsfunktionen für Assertions ───────────────────────────────────────────

function getCheck(result, id) {
  return result.checks.find((c) => c.id === id);
}

function expectCheckStatus(result, id, status) {
  const check = getCheck(result, id);
  expect(check).toBeDefined();
  expect(check.status).toBe(status);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('validateUseCaseDraft — vollständiger Draft', () => {
  let result;

  beforeAll(() => {
    result = validateUseCaseDraft(FULL_VALID_DRAFT);
  });

  test('passed ist true', () => {
    expect(result.passed).toBe(true);
  });

  test('blocking ist leer', () => {
    expect(result.blocking).toHaveLength(0);
  });

  test('score ist 100 (alle Checks pass)', () => {
    expect(result.score).toBe(100);
  });

  test('alle Checks haben status pass', () => {
    const nonPass = result.checks.filter((c) => c.status !== 'pass');
    expect(nonPass).toHaveLength(0);
  });

  test('checks enthält alle erwarteten IDs', () => {
    const ids = result.checks.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([
      'title', 'description', 'data_sources', 'mitre_mapping',
      'fp_risks', 'test_cases', 'severity', 'confidence',
      'detection_logic', 'recommended_actions',
    ]));
  });
});

// ─── Pflichtfeld-Fails ─────────────────────────────────────────────────────────

describe('validateUseCaseDraft — fehlender Titel', () => {
  test('title-Check schlägt fehl, passed ist false', () => {
    const result = validateUseCaseDraft(draftWith({ title: '' }));
    expectCheckStatus(result, 'title', 'fail');
    expect(result.passed).toBe(false);
    expect(result.blocking).toContain('title');
  });

  test('null als Titel → fail', () => {
    const result = validateUseCaseDraft(draftWith({ title: null }));
    expectCheckStatus(result, 'title', 'fail');
  });

  test('whitespace-only Titel → fail', () => {
    const result = validateUseCaseDraft(draftWith({ title: '   ' }));
    expectCheckStatus(result, 'title', 'fail');
  });
});

describe('validateUseCaseDraft — fehlende Beschreibung / Erkennungsziel', () => {
  test('fehlende description → fail', () => {
    const result = validateUseCaseDraft(draftWith({ description: '' }));
    expectCheckStatus(result, 'description', 'fail');
    expect(result.passed).toBe(false);
  });

  test('fehlendes detectionGoal → fail', () => {
    const result = validateUseCaseDraft(draftWith({ detectionGoal: null }));
    expectCheckStatus(result, 'description', 'fail');
  });

  test('beides fehlt → fail', () => {
    const result = validateUseCaseDraft(draftWith({ description: undefined, detectionGoal: undefined }));
    expectCheckStatus(result, 'description', 'fail');
  });
});

describe('validateUseCaseDraft — fehlende Datenquellen', () => {
  test('leeres Array → fail', () => {
    const result = validateUseCaseDraft(draftWith({ dataSources: [] }));
    expectCheckStatus(result, 'data_sources', 'fail');
    expect(result.passed).toBe(false);
  });

  test('kein Array → fail', () => {
    const result = validateUseCaseDraft(draftWith({ dataSources: undefined }));
    expectCheckStatus(result, 'data_sources', 'fail');
  });
});

describe('validateUseCaseDraft — MITRE-Mapping', () => {
  test('leeres mitre-Array → fail', () => {
    const result = validateUseCaseDraft(draftWith({ mitre: [] }));
    expectCheckStatus(result, 'mitre_mapping', 'fail');
    expect(result.passed).toBe(false);
  });

  test('mitre fehlt → fail', () => {
    const result = validateUseCaseDraft(draftWith({ mitre: null }));
    expectCheckStatus(result, 'mitre_mapping', 'fail');
  });

  test('mitre mit leerem tactic/technique → fail', () => {
    const result = validateUseCaseDraft(draftWith({ mitre: [{ tactic: '', technique: '' }] }));
    expectCheckStatus(result, 'mitre_mapping', 'fail');
  });

  test('ein gültiger Eintrag → pass', () => {
    const result = validateUseCaseDraft(draftWith({ mitre: [{ tactic: 'Execution', technique: 'T1059.001' }] }));
    expectCheckStatus(result, 'mitre_mapping', 'pass');
  });
});

describe('validateUseCaseDraft — False-Positive-Risiken', () => {
  test('leere falsePositiveRisks → fail', () => {
    const result = validateUseCaseDraft(draftWith({ falsePositiveRisks: [] }));
    expectCheckStatus(result, 'fp_risks', 'fail');
    expect(result.passed).toBe(false);
  });

  test('fehlend → fail', () => {
    const result = validateUseCaseDraft(draftWith({ falsePositiveRisks: undefined }));
    expectCheckStatus(result, 'fp_risks', 'fail');
  });
});

describe('validateUseCaseDraft — Testfälle', () => {
  test('keine Testfälle → fail (nicht nur warn)', () => {
    const result = validateUseCaseDraft(draftWith({ testCases: [] }));
    expectCheckStatus(result, 'test_cases', 'fail');
    expect(result.passed).toBe(false);
  });

  test('nur TP, kein FP → warn (nicht blockierend)', () => {
    const result = validateUseCaseDraft(draftWith({
      testCases: [{ name: 'TP', type: 'true_positive', event: {}, expectedResult: 'alert' }],
    }));
    expectCheckStatus(result, 'test_cases', 'warn');
    // warn blockt NICHT
    expect(result.blocking).not.toContain('test_cases');
    // passed kann trotzdem true sein (warn blockiert nicht)
    const otherFails = result.checks.filter((c) => c.status === 'fail');
    if (otherFails.length === 0) {
      expect(result.passed).toBe(true);
    }
  });

  test('nur FP, kein TP → fail', () => {
    const result = validateUseCaseDraft(draftWith({
      testCases: [{ name: 'FP', type: 'false_positive', event: {}, expectedResult: 'no alert' }],
    }));
    expectCheckStatus(result, 'test_cases', 'fail');
    expect(result.passed).toBe(false);
  });

  test('TP + FP vorhanden → pass', () => {
    const result = validateUseCaseDraft(FULL_VALID_DRAFT);
    expectCheckStatus(result, 'test_cases', 'pass');
  });
});

describe('validateUseCaseDraft — Severity', () => {
  test.each(['low', 'medium', 'high', 'critical'])('severity "%s" → pass', (sev) => {
    const result = validateUseCaseDraft(draftWith({ severity: sev }));
    expectCheckStatus(result, 'severity', 'pass');
  });

  test('ungültige severity → fail', () => {
    const result = validateUseCaseDraft(draftWith({ severity: 'extreme' }));
    expectCheckStatus(result, 'severity', 'fail');
    expect(result.passed).toBe(false);
  });

  test('severity fehlt (undefined) → fail', () => {
    const result = validateUseCaseDraft(draftWith({ severity: undefined }));
    expectCheckStatus(result, 'severity', 'fail');
  });
});

describe('validateUseCaseDraft — Confidence', () => {
  test('confidence 0 → pass (Randwert)', () => {
    const result = validateUseCaseDraft(draftWith({ confidence: 0 }));
    expectCheckStatus(result, 'confidence', 'pass');
  });

  test('confidence 100 → pass (Randwert)', () => {
    const result = validateUseCaseDraft(draftWith({ confidence: 100 }));
    expectCheckStatus(result, 'confidence', 'pass');
  });

  test('confidence 75 → pass', () => {
    const result = validateUseCaseDraft(draftWith({ confidence: 75 }));
    expectCheckStatus(result, 'confidence', 'pass');
  });

  test('confidence -1 → fail', () => {
    const result = validateUseCaseDraft(draftWith({ confidence: -1 }));
    expectCheckStatus(result, 'confidence', 'fail');
    expect(result.passed).toBe(false);
  });

  test('confidence 101 → fail', () => {
    const result = validateUseCaseDraft(draftWith({ confidence: 101 }));
    expectCheckStatus(result, 'confidence', 'fail');
  });

  test('confidence als String → fail', () => {
    const result = validateUseCaseDraft(draftWith({ confidence: '75' }));
    expectCheckStatus(result, 'confidence', 'fail');
  });

  test('confidence fehlt → fail', () => {
    const result = validateUseCaseDraft(draftWith({ confidence: undefined }));
    expectCheckStatus(result, 'confidence', 'fail');
  });
});

describe('validateUseCaseDraft — Detection Logic', () => {
  test('leere queryOrRule → fail', () => {
    const result = validateUseCaseDraft(draftWith({
      detectionLogic: { language: 'sigma', queryOrRule: '', explanation: 'x' },
    }));
    expectCheckStatus(result, 'detection_logic', 'fail');
    expect(result.passed).toBe(false);
  });

  test('detectionLogic komplett fehlend → fail', () => {
    const result = validateUseCaseDraft(draftWith({ detectionLogic: null }));
    expectCheckStatus(result, 'detection_logic', 'fail');
  });

  test('queryOrRule vorhanden → pass', () => {
    const result = validateUseCaseDraft(draftWith({
      detectionLogic: { language: 'kql', queryOrRule: 'process.name:powershell.exe', explanation: '' },
    }));
    expectCheckStatus(result, 'detection_logic', 'pass');
  });
});

describe('validateUseCaseDraft — empfohlene Aktionen', () => {
  test('recommendedActions + playbookSteps leer → warn (nicht fail, nicht blockierend)', () => {
    const result = validateUseCaseDraft(draftWith({
      recommendedActions: [],
      playbookSteps: [],
    }));
    expectCheckStatus(result, 'recommended_actions', 'warn');
    expect(result.blocking).not.toContain('recommended_actions');
  });

  test('nur recommendedActions befüllt → pass', () => {
    const result = validateUseCaseDraft(draftWith({ playbookSteps: [] }));
    expectCheckStatus(result, 'recommended_actions', 'pass');
  });

  test('nur playbookSteps befüllt → pass', () => {
    const result = validateUseCaseDraft(draftWith({ recommendedActions: [] }));
    expectCheckStatus(result, 'recommended_actions', 'pass');
  });
});

// ─── Score-Berechnung ─────────────────────────────────────────────────────────

describe('validateUseCaseDraft — Score-Berechnung', () => {
  test('vollständiger Draft → score 100', () => {
    const result = validateUseCaseDraft(FULL_VALID_DRAFT);
    expect(result.score).toBe(100);
  });

  test('Draft mit einem fail → score < 100', () => {
    const result = validateUseCaseDraft(draftWith({ dataSources: [] }));
    expect(result.score).toBeLessThan(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  test('score ist immer zwischen 0 und 100', () => {
    const result = validateUseCaseDraft({});
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// ─── Defensive Robustheit ─────────────────────────────────────────────────────

describe('validateUseCaseDraft — Robustheit / defensiv', () => {
  test('null als Input → kein Crash, alle Checks fail', () => {
    expect(() => validateUseCaseDraft(null)).not.toThrow();
    const result = validateUseCaseDraft(null);
    expect(result.passed).toBe(false);
    expect(result.checks.every((c) => c.status === 'fail' || c.status === 'warn')).toBe(true);
  });

  test('undefined als Input → kein Crash', () => {
    expect(() => validateUseCaseDraft(undefined)).not.toThrow();
    const result = validateUseCaseDraft(undefined);
    expect(result.passed).toBe(false);
  });

  test('leeres Objekt {} → kein Crash, passed false', () => {
    expect(() => validateUseCaseDraft({})).not.toThrow();
    const result = validateUseCaseDraft({});
    expect(result.passed).toBe(false);
  });

  test('String als Input → kein Crash', () => {
    expect(() => validateUseCaseDraft('invalid')).not.toThrow();
    const result = validateUseCaseDraft('invalid');
    expect(result.passed).toBe(false);
  });

  test('Array als Input → kein Crash', () => {
    expect(() => validateUseCaseDraft([])).not.toThrow();
  });

  test('mitre mit null-Einträgen → kein Crash', () => {
    const result = validateUseCaseDraft(draftWith({ mitre: [null, undefined, { tactic: 'x', technique: 'T1' }] }));
    expect(() => validateUseCaseDraft(draftWith({ mitre: [null] }))).not.toThrow();
    expect(result.passed).toBe(true);
  });

  test('testCases mit null-Einträgen → kein Crash', () => {
    expect(() => validateUseCaseDraft(draftWith({ testCases: [null, undefined] }))).not.toThrow();
  });

  test('Rückgabe enthält immer checks, passed, score, blocking', () => {
    const result = validateUseCaseDraft(null);
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('blocking');
    expect(Array.isArray(result.checks)).toBe(true);
    expect(Array.isArray(result.blocking)).toBe(true);
    expect(typeof result.passed).toBe('boolean');
    expect(typeof result.score).toBe('number');
  });
});

// ─── warn blockt NICHT ────────────────────────────────────────────────────────

describe('validateUseCaseDraft — warn blockiert passed nicht', () => {
  test('Draft mit nur TP-Test (warn) + allem anderen korrekt → passed true', () => {
    const draft = draftWith({
      testCases: [{ name: 'TP', type: 'true_positive', event: {}, expectedResult: 'alert' }],
      recommendedActions: [],
      playbookSteps: [],
    });
    const result = validateUseCaseDraft(draft);
    // Zwei Warns (test_cases + recommended_actions), keine Fails
    const fails = result.checks.filter((c) => c.status === 'fail');
    const warns = result.checks.filter((c) => c.status === 'warn');
    expect(fails).toHaveLength(0);
    expect(warns.length).toBeGreaterThan(0);
    expect(result.passed).toBe(true);
    expect(result.blocking).toHaveLength(0);
  });
});
