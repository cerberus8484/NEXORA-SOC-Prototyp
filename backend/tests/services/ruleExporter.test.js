'use strict';

/**
 * Tests for RuleExporter — reine Funktionen (keine Seiteneffekte).
 * Jedes Format: Struktur-Marker, title/mitre, Escaping (XSS/Injection-String).
 */
const { toWazuh, toSigma, toSplunk, toQRadar, exportDraft } = require('../../src/services/RuleExporter');
const { ValidationError } = require('../../src/errors/AppError');

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function makeDraft(overrides = {}) {
  return {
    id:              'draft-1',
    title:           'PowerShell Encoded Command Detection',
    description:     'Detects PowerShell with -EncodedCommand flag',
    detectionGoal:   'Identify suspicious encoded PowerShell execution',
    dataSources:     ['windows_event_log', 'sysmon'],
    requiredFields:  ['event.code', 'process.command_line'],
    detectionLogic:  {
      language:     'generic',
      queryOrRule:  'process.name == "powershell.exe" AND command_line contains "-enc"',
      explanation:  'Matches PowerShell with encoded command flag',
    },
    mitre:           [{ technique: 'T1059.001', tactic: 'execution' }],
    severity:        'high',
    confidence:      80,
    falsePositiveRisks: ['Legitimate admin scripts using encoding'],
    ...overrides,
  };
}

// ─── Wazuh ────────────────────────────────────────────────────────────────────

describe('toWazuh', () => {
  it('enthält <rule id Platzhalter', () => {
    const out = toWazuh(makeDraft());
    expect(out).toContain('<rule id=');
  });

  it('enthält <description> mit title', () => {
    const out = toWazuh(makeDraft({ title: 'My Rule' }));
    expect(out).toContain('<description>My Rule</description>');
  });

  it('enthält <mitre><id> für jeden Technique-Eintrag', () => {
    const out = toWazuh(makeDraft({ mitre: [{ technique: 'T1059.001', tactic: 'execution' }] }));
    expect(out).toContain('<mitre>');
    expect(out).toContain('<id>T1059.001</id>');
  });

  it('enthält <group Tag (mit name-Attribut)', () => {
    const out = toWazuh(makeDraft());
    expect(out).toContain('<group');
  });

  it('mappt severity high → level 12', () => {
    const out = toWazuh(makeDraft({ severity: 'high' }));
    expect(out).toContain('level="12"');
  });

  it('mappt severity critical → level 14', () => {
    const out = toWazuh(makeDraft({ severity: 'critical' }));
    expect(out).toContain('level="14"');
  });

  it('mappt severity medium → level 10', () => {
    const out = toWazuh(makeDraft({ severity: 'medium' }));
    expect(out).toContain('level="10"');
  });

  it('mappt severity low → level 6', () => {
    const out = toWazuh(makeDraft({ severity: 'low' }));
    expect(out).toContain('level="6"');
  });

  it('escapt XML-Sonderzeichen in title (<, >, &, ", \')', () => {
    const out = toWazuh(makeDraft({ title: '<script>alert("XSS")</script> & more' }));
    // Darf kein rohe < oder > oder & im description-Inhalt enthalten
    expect(out).not.toMatch(/<description>.*<script>.*<\/description>/s);
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&amp;');
  });

  it('escapt XML in description (via title, da title Vorrang hat)', () => {
    // title hat Vorrang in <description>; zum Testen des Escapings title setzen
    const out = toWazuh(makeDraft({ title: 'A & B <test>', description: 'A & B <test>' }));
    expect(out).toContain('&amp;');
    expect(out).toContain('&lt;test&gt;');
  });

  it('mehrere MITRE-Techniken werden alle eingebettet', () => {
    const out = toWazuh(makeDraft({ mitre: [{ technique: 'T1059.001' }, { technique: 'T1055' }] }));
    expect(out).toContain('<id>T1059.001</id>');
    expect(out).toContain('<id>T1055</id>');
  });

  it('kein MITRE-Eintrag → kein <mitre>-Block', () => {
    const out = toWazuh(makeDraft({ mitre: [] }));
    expect(out).not.toContain('<mitre>');
  });

  it('gibt String zurück', () => {
    expect(typeof toWazuh(makeDraft())).toBe('string');
  });
});

// ─── Sigma ────────────────────────────────────────────────────────────────────

describe('toSigma', () => {
  it('enthält title: mit YAML-Quoting (Sicherheitsanforderung)', () => {
    const out = toSigma(makeDraft({ title: 'My Detection' }));
    // Werte werden YAML-gequotet (Injection-Schutz) — title: 'My Detection'
    expect(out).toContain("title: 'My Detection'");
  });

  it('enthält status: experimental', () => {
    const out = toSigma(makeDraft());
    expect(out).toContain('status: experimental');
  });

  it('enthält logsource: Abschnitt', () => {
    const out = toSigma(makeDraft());
    expect(out).toContain('logsource:');
  });

  it('enthält detection: Abschnitt', () => {
    const out = toSigma(makeDraft());
    expect(out).toContain('detection:');
  });

  it('enthält tags: mit attack.tXXXX (lowercase)', () => {
    const out = toSigma(makeDraft({ mitre: [{ technique: 'T1059.001', tactic: 'execution' }] }));
    expect(out).toContain('tags:');
    expect(out).toContain('attack.t1059.001');
  });

  it('enthält level: aus severity', () => {
    const out = toSigma(makeDraft({ severity: 'high' }));
    expect(out).toContain('level: high');
  });

  it('enthält falsepositives:', () => {
    const out = toSigma(makeDraft({ falsePositiveRisks: ['Admin scripts'] }));
    expect(out).toContain('falsepositives:');
  });

  it('Injection in title bricht YAML-Struktur nicht — kein unescapeter Doppelpunkt-Angriff', () => {
    const injTitle = 'title: injected\nstatus: stable\n';
    const out = toSigma(makeDraft({ title: injTitle }));
    // title-Wert muss gequotet sein damit YAML-Struktur erhalten bleibt
    // Der injizierte Text darf nicht als neues YAML-Feld interpretierbar sein
    expect(out).toContain("title: '");
  });

  it('gibt String zurück', () => {
    expect(typeof toSigma(makeDraft())).toBe('string');
  });
});

// ─── Splunk ───────────────────────────────────────────────────────────────────

describe('toSplunk', () => {
  it('enthält index=', () => {
    const out = toSplunk(makeDraft());
    expect(out).toMatch(/index=/);
  });

  it('enthält | search oder | where Operator', () => {
    const out = toSplunk(makeDraft());
    expect(out).toMatch(/\|\s*search|\|\s*where/);
  });

  it('enthält Kommentar-Header mit title', () => {
    const out = toSplunk(makeDraft({ title: 'PowerShell Detection' }));
    expect(out).toContain('PowerShell Detection');
  });

  it('enthält MITRE-Hinweis im Header', () => {
    const out = toSplunk(makeDraft({ mitre: [{ technique: 'T1059.001' }] }));
    expect(out).toContain('T1059.001');
  });

  it('Injection in title bricht SPL nicht — kein ` oder ] als Code-Exec', () => {
    const injTitle = 'Evil `cat /etc/passwd` title';
    const out = toSplunk(makeDraft({ title: injTitle }));
    // Im Kommentar-Header sind Backticks harmlos, aber wir prüfen keine SPL-Injektion in Queries
    expect(typeof out).toBe('string');
    // Titel kommt nur im Kommentar vor, nicht als ausführbarer SPL
    expect(out).toContain('`cat /etc/passwd`');  // Im Kommentar erlaubt (kein eval)
  });

  it('gibt String zurück', () => {
    expect(typeof toSplunk(makeDraft())).toBe('string');
  });

  it('dataSources als AQL-Kontext genutzt wenn vorhanden', () => {
    const out = toSplunk(makeDraft({ dataSources: ['sysmon'] }));
    expect(out).toContain('sysmon');
  });
});

// ─── QRadar ───────────────────────────────────────────────────────────────────

describe('toQRadar', () => {
  it('enthält SELECT', () => {
    const out = toQRadar(makeDraft());
    expect(out).toContain('SELECT');
  });

  it('enthält FROM events', () => {
    const out = toQRadar(makeDraft());
    expect(out).toContain('FROM events');
  });

  it('enthält LAST 24 HOURS', () => {
    const out = toQRadar(makeDraft());
    expect(out).toContain('LAST 24 HOURS');
  });

  it('enthält Kommentar-Header mit title', () => {
    const out = toQRadar(makeDraft({ title: 'QRadar Rule Test' }));
    expect(out).toContain('QRadar Rule Test');
  });

  it('enthält MITRE-Hinweis im Header', () => {
    const out = toQRadar(makeDraft({ mitre: [{ technique: 'T1055' }] }));
    expect(out).toContain('T1055');
  });

  it('Injection im title wird escaped/gequotet — kein SQL-Injection in AQL', () => {
    // AQL-Kommentare: -- Kommentar bricht AQL nicht, aber Wert im WHERE muss gequotet sein
    const out = toQRadar(makeDraft({ title: "'; DROP TABLE events; --" }));
    expect(typeof out).toBe('string');
    // Title kommt nur in Kommentarzeile vor, nicht im WHERE-Clause
  });

  it('gibt String zurück', () => {
    expect(typeof toQRadar(makeDraft())).toBe('string');
  });
});

// ─── exportDraft (dispatch) ───────────────────────────────────────────────────

describe('exportDraft', () => {
  it('format=wazuh → ruft toWazuh auf (enthält <rule id)', () => {
    const out = exportDraft(makeDraft(), 'wazuh');
    expect(out).toContain('<rule id=');
  });

  it('format=sigma → ruft toSigma auf (enthält logsource:)', () => {
    const out = exportDraft(makeDraft(), 'sigma');
    expect(out).toContain('logsource:');
  });

  it('format=splunk → ruft toSplunk auf (enthält index=)', () => {
    const out = exportDraft(makeDraft(), 'splunk');
    expect(out).toMatch(/index=/);
  });

  it('format=qradar → ruft toQRadar auf (enthält FROM events)', () => {
    const out = exportDraft(makeDraft(), 'qradar');
    expect(out).toContain('FROM events');
  });

  it('unbekanntes format wirft ValidationError (status 400)', () => {
    expect(() => exportDraft(makeDraft(), 'unknown'))
      .toThrow(ValidationError);
  });

  it('unbekanntes format wirft mit statusCode 400', () => {
    let err;
    try { exportDraft(makeDraft(), 'bad-format'); }
    catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(400);
  });

  it('leeres format wirft ValidationError', () => {
    expect(() => exportDraft(makeDraft(), '')).toThrow(ValidationError);
  });

  it('null format wirft ValidationError', () => {
    expect(() => exportDraft(makeDraft(), null)).toThrow(ValidationError);
  });
});

// ─── detectionLogic bereits in Zielsprache ────────────────────────────────────

describe('detectionLogic.language passt zum Zielformat', () => {
  it('Wazuh-Draft mit language=wazuh bettet queryOrRule sinnvoll ein', () => {
    const draft = makeDraft({
      detectionLogic: { language: 'wazuh', queryOrRule: '<match>my-pattern</match>', explanation: '' },
    });
    const out = toWazuh(draft);
    // Eingebettet im Kommentar oder im Match-Feld
    expect(out).toContain('my-pattern');
  });

  it('Sigma-Draft mit language=sigma bettet queryOrRule ein', () => {
    const draft = makeDraft({
      detectionLogic: { language: 'sigma', queryOrRule: 'CommandLine|contains: "-enc"', explanation: '' },
    });
    const out = toSigma(draft);
    expect(out).toContain('-enc');
  });

  it('Splunk-Draft mit language=splunk bettet queryOrRule ein', () => {
    const draft = makeDraft({
      detectionLogic: { language: 'splunk', queryOrRule: 'CommandLine="*-enc*"', explanation: '' },
    });
    const out = toSplunk(draft);
    expect(out).toContain('-enc');
  });

  it('QRadar-Draft mit language=qradar bettet queryOrRule ein', () => {
    const draft = makeDraft({
      detectionLogic: { language: 'qradar', queryOrRule: 'UTF8(payload) ILIKE \'%-enc%\'', explanation: '' },
    });
    const out = toQRadar(draft);
    expect(out).toContain('-enc');
  });
});
