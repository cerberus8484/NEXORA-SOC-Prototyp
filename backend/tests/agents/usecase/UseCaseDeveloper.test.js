'use strict';

const { build: buildPrompt, buildContextLines } = require('../../../src/agents/usecase/UseCasePromptBuilder');
const { OllamaUseCaseDeveloperProvider, mapToDraft, extractJson } = require('../../../src/agents/usecase/OllamaUseCaseDeveloperProvider');
const { StubUseCaseDeveloperProvider }  = require('../../../src/agents/usecase/StubUseCaseDeveloperProvider');
const { InMemoryHttpClient }            = require('../../../src/integrations/http/InMemoryHttpClient');
const { ServiceUnavailableError }       = require('../../../src/errors/AppError');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MINIMAL_CONTEXT = {
  ticket: { id: 'T-042', title: 'PowerShell enc Test', priority: 'high' },
};

const FULL_CONTEXT = {
  ticket: {
    id: 'T-042',
    title: 'PowerShell EncodedCommand Ausführung erkannt',
    category: 'Malware',
    priority: 'high',
    source: 'wazuh',
    datetime: '2026-06-14T08:30:00Z',
    description: 'Agent WEC01 meldet Sysmon EventID 1 mit powershell -EncodedCommand',
  },
  finding: {
    ruleId:          '92200',
    ruleLevel:       12,
    ruleDescription: 'Sysmon Process Creation',
    mitreTactics:    ['Execution'],
    mitreTechniques: ['T1059.001'],
    agentName:       'WEC01',
    agentIp:         '10.99.99.11',
    location:        'EventChannel',
    decoderName:     'windows_decoders',
    processName:     'powershell.exe',
    commandLine:     'powershell.exe -EncodedCommand aABlAGwAbABvAA==',
    hashSha256:      'aabbccdd1234',
    srcIp:           '192.168.241.55',
  },
  evidence: [
    { source: 'sysmon', value: 'Process powershell.exe started by cmd.exe' },
    { source: 'wazuh',  value: 'Rule 92200 matched, level 12' },
  ],
  wazuhRule: {
    id:          '92200',
    groups:      ['sysmon', 'windows'],
    description: 'Sysmon Process Creation',
    level:       12,
  },
};

const VALID_LLM_RESPONSE = {
  title: 'PowerShell EncodedCommand Detection',
  description: 'Erkennt obfuskierte PowerShell-Ausführung.',
  detection_goal: 'T1059.001 PowerShell via EncodedCommand',
  data_sources: ['Sysmon EventID 1'],
  required_fields: ['process.name', 'process.command_line'],
  detection_logic: {
    language: 'Sigma',
    query_or_rule: 'CommandLine contains -EncodedCommand',
    explanation: 'Matcht EncodedCommand-Parameter.',
  },
  mitre: [{ tactic: 'Execution', technique: 'T1059.001' }],
  severity: 'high',
  confidence: 80,
  false_positive_risks: ['SCCM-Deployment'],
  test_cases: [
    {
      name: 'TP: Angreifer',
      type: 'true_positive',
      event: { note: 'synthetisch', host: 'PC-001.example.internal', user: 'EXAMPLE\\user01' },
      expected_result: 'Alarm ausgelöst',
    },
    {
      name: 'FP: SCCM',
      type: 'false_positive',
      event: { note: 'synthetisch', host: 'PC-002.example.internal', parentImage: 'CcmExec.exe' },
      expected_result: 'Alarm aber FP möglich',
    },
  ],
  recommended_actions: ['CommandLine dekodieren', 'Parent-Prozess prüfen'],
  playbook_steps: ['1. Alert öffnen', '2. CommandLine dekodieren'],
};

// ── 1. UseCasePromptBuilder ───────────────────────────────────────────────────

describe('UseCasePromptBuilder', () => {

  describe('build(context)', () => {
    test('erzeugt einen nicht-leeren String', () => {
      const prompt = buildPrompt(MINIMAL_CONTEXT);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(100);
    });

    test('enthält Rollen-Anweisung als Detection Engineer', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toMatch(/Detection Engineer/i);
    });

    test('enthält JSON-Ausgabe-Anweisung (Guardrail)', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toMatch(/AUSSCHLIESSLICH.*JSON|JSON.*ONLY/i);
    });

    test('enthält Prompt-Injection-Schutz-Hinweis', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toMatch(/Prompt-Injection/i);
    });

    test('enthält Guardrail gegen produktives Deployment', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toMatch(/kein.*Deployment|KEINE.*Regelaktivierung/i);
    });

    test('enthält DSGVO-Anforderung für synthetische Testfälle', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toMatch(/DSGVO|synthetisch|ANONYMISIERT/i);
    });

    test('enthält MITRE-Mapping-Anforderung', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toMatch(/MITRE ATT&CK/i);
    });

    test('enthält Confidence-Score-Erklärung', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toMatch(/Confidence.*0.{0,5}100|90.{0,10}100/i);
    });

    test('enthält JSON-Schema mit allen Pflichtfeldern', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toMatch(/detection_logic/);
      expect(prompt).toMatch(/false_positive_risks/);
      expect(prompt).toMatch(/test_cases/);
      expect(prompt).toMatch(/playbook_steps/);
      expect(prompt).toMatch(/recommended_actions/);
    });

    test('bettet Ticket-ID und Titel aus dem Kontext ein', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toContain('T-042');
      expect(prompt).toContain('PowerShell EncodedCommand');
    });

    test('bettet Finding-Felder ein', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toContain('92200');
      expect(prompt).toContain('WEC01');
      expect(prompt).toContain('T1059.001');
    });

    test('bettet Evidence-Einträge ein', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toContain('[Evidence]');
      expect(prompt).toContain('sysmon');
    });

    test('bettet Wazuh-Rule-Kontext ein', () => {
      const prompt = buildPrompt(FULL_CONTEXT);
      expect(prompt).toContain('Wazuh-Regel');
    });

    test('funktioniert mit leerem Kontext', () => {
      const prompt = buildPrompt({});
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(50);
    });

    test('funktioniert mit null-Kontext', () => {
      const prompt = buildPrompt(null);
      expect(typeof prompt).toBe('string');
    });

    test('lässt leere/null-Felder weg (keine "undefined"-Zeilen)', () => {
      const prompt = buildPrompt({ ticket: { id: 'T-001', title: null, priority: undefined } });
      expect(prompt).not.toContain('undefined');
      expect(prompt).not.toContain('null');
    });
  });

  describe('buildContextLines(context)', () => {
    test('gibt Array zurück', () => {
      expect(Array.isArray(buildContextLines({}))).toBe(true);
    });

    test('enthält Ticket-Felder wenn vorhanden', () => {
      const lines = buildContextLines({ ticket: { id: 'T-99', title: 'Test' } });
      expect(lines.some((l) => l.includes('T-99'))).toBe(true);
    });

    test('beschränkt Evidence auf max. 8 Einträge', () => {
      const evidence = Array.from({ length: 12 }, (_, i) => ({ source: `src${i}`, value: `val${i}` }));
      const lines = buildContextLines({ evidence });
      const evidenceLines = lines.filter((l) => l.includes('[Evidence]'));
      expect(evidenceLines.length).toBeLessThanOrEqual(8);
    });
  });
});

// ── 2. extractJson (interne Hilfsfunktion) ────────────────────────────────────

describe('extractJson', () => {
  test('parst direktes JSON-Objekt', () => {
    const result = extractJson('{"title":"test","confidence":80}');
    expect(result.title).toBe('test');
    expect(result.confidence).toBe(80);
  });

  test('extrahiert JSON aus Markdown-Fence', () => {
    const raw = '```json\n{"title":"fenced"}\n```';
    expect(extractJson(raw).title).toBe('fenced');
  });

  test('extrahiert erstes balanciertes Objekt aus gemischtem Text', () => {
    const raw = 'Hier ist das Ergebnis: {"title":"mixed"} Ende.';
    expect(extractJson(raw).title).toBe('mixed');
  });

  test('wirft expliziten Fehler bei reinem Text ohne JSON', () => {
    expect(() => extractJson('keine json hier')).toThrow(
      /kein valides JSON-Objekt/,
    );
  });

  test('wirft expliziten Fehler bei kaputtem JSON', () => {
    expect(() => extractJson('{"title":"offen')).toThrow();
  });

  test('wirft expliziten Fehler bei leerem String', () => {
    expect(() => extractJson('')).toThrow();
  });
});

// ── 3. mapToDraft ─────────────────────────────────────────────────────────────

describe('mapToDraft', () => {
  test('mappt snake_case zu camelCase', () => {
    const draft = mapToDraft(VALID_LLM_RESPONSE, 'ollama-test');
    expect(draft.detectionGoal).toBe('T1059.001 PowerShell via EncodedCommand');
    expect(draft.dataSources).toEqual(['Sysmon EventID 1']);
    expect(draft.requiredFields).toEqual(['process.name', 'process.command_line']);
    expect(draft.detectionLogic.queryOrRule).toBe('CommandLine contains -EncodedCommand');
    expect(draft.falsePositiveRisks).toEqual(['SCCM-Deployment']);
    expect(draft.recommendedActions).toEqual(['CommandLine dekodieren', 'Parent-Prozess prüfen']);
    expect(draft.playbookSteps).toEqual(['1. Alert öffnen', '2. CommandLine dekodieren']);
  });

  test('setzt status immer auf "draft"', () => {
    const obj = { ...VALID_LLM_RESPONSE, status: 'active' };
    const draft = mapToDraft(obj, 'test');
    expect(draft.status).toBe('draft');
  });

  test('setzt generatedBy immer auf "ollama"', () => {
    const obj = { ...VALID_LLM_RESPONSE, generatedBy: 'human' };
    const draft = mapToDraft(obj, 'test');
    expect(draft.generatedBy).toBe('ollama');
  });

  test('mappt MITRE korrekt', () => {
    const draft = mapToDraft(VALID_LLM_RESPONSE, 'test');
    expect(draft.mitre).toEqual([{ tactic: 'Execution', technique: 'T1059.001' }]);
  });

  test('mappt Testfälle korrekt (snake_case → camelCase)', () => {
    const draft = mapToDraft(VALID_LLM_RESPONSE, 'test');
    expect(draft.testCases).toHaveLength(2);
    expect(draft.testCases[0].expectedResult).toBe('Alarm ausgelöst');
    expect(draft.testCases[0].type).toBe('true_positive');
    expect(draft.testCases[1].type).toBe('false_positive');
  });

  test('clamped confidence auf 0–100', () => {
    const draft1 = mapToDraft({ ...VALID_LLM_RESPONSE, confidence: 150 }, 'test');
    expect(draft1.confidence).toBe(100);
    const draft2 = mapToDraft({ ...VALID_LLM_RESPONSE, confidence: -5 }, 'test');
    expect(draft2.confidence).toBe(0);
  });

  test('toleriert fehlende optionale Felder → leere Arrays', () => {
    const draft = mapToDraft({ title: 'minimal' }, 'test');
    expect(Array.isArray(draft.dataSources)).toBe(true);
    expect(Array.isArray(draft.testCases)).toBe(true);
    expect(draft.status).toBe('draft');
  });

  test('akzeptiert mitre_attack als Alias für mitre', () => {
    const obj = { ...VALID_LLM_RESPONSE, mitre: undefined, mitre_attack: [{ tactic: 'Impact', technique: 'T1486' }] };
    const draft = mapToDraft(obj, 'test');
    expect(draft.mitre[0].tactic).toBe('Impact');
  });

  test('setzt model auf den übergebenen Namen', () => {
    const draft = mapToDraft(VALID_LLM_RESPONSE, 'ollama-usecase:llama3.2:3b');
    expect(draft.model).toBe('ollama-usecase:llama3.2:3b');
  });
});

// ── 4. OllamaUseCaseDeveloperProvider ────────────────────────────────────────

describe('OllamaUseCaseDeveloperProvider', () => {
  let http;
  let provider;

  beforeEach(() => {
    http     = new InMemoryHttpClient();
    provider = new OllamaUseCaseDeveloperProvider({
      baseUrl: 'http://localhost:11434',
      model:   'llama3.2:3b',
      http,
    });
  });

  describe('develop(context) — Erfolgsfall', () => {
    test('sendet POST an /api/generate', async () => {
      http.queueResponse(200, { response: JSON.stringify(VALID_LLM_RESPONSE) });
      await provider.develop(MINIMAL_CONTEXT);
      const req = http.getLastRequest();
      expect(req.url).toContain('/api/generate');
      expect(req.method).toBe('POST');
    });

    test('gibt vollständigen UseCaseDraft zurück', async () => {
      http.queueResponse(200, { response: JSON.stringify(VALID_LLM_RESPONSE) });
      const draft = await provider.develop(FULL_CONTEXT);
      expect(draft.title).toBe('PowerShell EncodedCommand Detection');
      expect(draft.status).toBe('draft');
      expect(draft.generatedBy).toBe('ollama');
      expect(draft.model).toContain('ollama-usecase:');
    });

    test('mappt alle camelCase-Felder korrekt', async () => {
      http.queueResponse(200, { response: JSON.stringify(VALID_LLM_RESPONSE) });
      const draft = await provider.develop(FULL_CONTEXT);
      expect(draft.detectionGoal).toBeTruthy();
      expect(Array.isArray(draft.dataSources)).toBe(true);
      expect(Array.isArray(draft.testCases)).toBe(true);
      expect(draft.detectionLogic).toHaveProperty('queryOrRule');
      expect(draft.detectionLogic).toHaveProperty('language');
      expect(draft.detectionLogic).toHaveProperty('explanation');
    });

    test('übernimmt sourceType und sourceId aus dem Kontext', async () => {
      http.queueResponse(200, { response: JSON.stringify(VALID_LLM_RESPONSE) });
      const ctx = { ...FULL_CONTEXT, sourceType: 'ticket', sourceId: 'T-042' };
      const draft = await provider.develop(ctx);
      expect(draft.sourceType).toBe('ticket');
      expect(draft.sourceId).toBe('T-042');
    });

    test('akzeptiert JSON in Markdown-Fence', async () => {
      const raw = '```json\n' + JSON.stringify(VALID_LLM_RESPONSE) + '\n```';
      http.queueResponse(200, { response: raw });
      const draft = await provider.develop(MINIMAL_CONTEXT);
      expect(draft.title).toBe('PowerShell EncodedCommand Detection');
    });

    test('akzeptiert JSON nach Prosa-Text', async () => {
      const raw = 'Hier ist der Use Case:\n' + JSON.stringify(VALID_LLM_RESPONSE);
      http.queueResponse(200, { response: raw });
      const draft = await provider.develop(MINIMAL_CONTEXT);
      expect(draft.status).toBe('draft');
    });

    test('sendet das model-Feld im Request-Body', async () => {
      http.queueResponse(200, { response: JSON.stringify(VALID_LLM_RESPONSE) });
      await provider.develop(MINIMAL_CONTEXT);
      const req = http.getLastRequest();
      expect(req.body.model).toBe('llama3.2:3b');
    });

    test('sendet format:json im Request-Body', async () => {
      http.queueResponse(200, { response: JSON.stringify(VALID_LLM_RESPONSE) });
      await provider.develop(MINIMAL_CONTEXT);
      const req = http.getLastRequest();
      expect(req.body.format).toBe('json');
    });

    test('begrenzt Antworten standardmäßig auf 512 Tokens', async () => {
      http.queueResponse(200, { response: JSON.stringify(VALID_LLM_RESPONSE) });
      await provider.develop(MINIMAL_CONTEXT);
      const req = http.getLastRequest();
      expect(req.body.options.num_predict).toBe(512);
    });
  });

  describe('develop(context) — Fehlerbehandlung', () => {
    test('wirft ServiceUnavailableError wenn HTTP-Request fehlschlägt', async () => {
      const netErr = new Error('ECONNREFUSED');
      jest.spyOn(http, 'request').mockRejectedValueOnce(netErr);
      await expect(provider.develop(MINIMAL_CONTEXT)).rejects.toThrow(ServiceUnavailableError);
    });

    test('ServiceUnavailableError enthält code USECASE_LLM_UNAVAILABLE', async () => {
      jest.spyOn(http, 'request').mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(provider.develop(MINIMAL_CONTEXT)).rejects.toMatchObject({
        code: 'USECASE_LLM_UNAVAILABLE',
      });
    });

    test('wirft ServiceUnavailableError mit USECASE_LLM_TIMEOUT bei Timeout', async () => {
      jest.spyOn(http, 'request').mockRejectedValueOnce(new Error('Request timeout ETIMEDOUT'));
      await expect(provider.develop(MINIMAL_CONTEXT)).rejects.toMatchObject({
        code: 'USECASE_LLM_TIMEOUT',
      });
    });

    test('wirft expliziten Fehler bei kaputtem JSON (kein Silent-Fail)', async () => {
      http.queueResponse(200, { response: 'kein json hier' });
      await expect(provider.develop(MINIMAL_CONTEXT)).rejects.toThrow(/kein valides JSON-Objekt/);
    });

    test('wirft expliziten Fehler bei leerem LLM-Response', async () => {
      http.queueResponse(200, { response: '' });
      await expect(provider.develop(MINIMAL_CONTEXT)).rejects.toThrow();
    });

    test('setzt status und generatedBy AUCH bei minimalem LLM-Output', async () => {
      http.queueResponse(200, { response: JSON.stringify({ title: 'minimal' }) });
      const draft = await provider.develop(MINIMAL_CONTEXT);
      expect(draft.status).toBe('draft');
      expect(draft.generatedBy).toBe('ollama');
    });
  });

  describe('name', () => {
    test('enthält "ollama-usecase:"', () => {
      expect(provider.name).toContain('ollama-usecase:');
    });
  });
});

// ── 5. StubUseCaseDeveloperProvider ──────────────────────────────────────────

describe('StubUseCaseDeveloperProvider', () => {
  let stub;

  beforeEach(() => {
    stub = new StubUseCaseDeveloperProvider();
  });

  test('name ist deterministisch', () => {
    expect(stub.name).toBe('stub-usecase-developer-v1');
  });

  test('develop() gibt UseCaseDraft zurück', async () => {
    const draft = await stub.develop({});
    expect(draft).toBeDefined();
    expect(typeof draft).toBe('object');
  });

  test('status ist immer "draft"', async () => {
    const draft = await stub.develop(null);
    expect(draft.status).toBe('draft');
  });

  test('generatedBy ist "stub"', async () => {
    const draft = await stub.develop({});
    expect(draft.generatedBy).toBe('stub');
  });

  test('title ist nicht leer', async () => {
    const draft = await stub.develop({});
    expect(draft.title.length).toBeGreaterThan(0);
  });

  test('description ist nicht leer', async () => {
    const draft = await stub.develop({});
    expect(draft.description.length).toBeGreaterThan(0);
  });

  test('detectionGoal ist nicht leer', async () => {
    const draft = await stub.develop({});
    expect(draft.detectionGoal.length).toBeGreaterThan(0);
  });

  test('dataSources ist nicht-leeres Array', async () => {
    const draft = await stub.develop({});
    expect(Array.isArray(draft.dataSources)).toBe(true);
    expect(draft.dataSources.length).toBeGreaterThan(0);
  });

  test('detectionLogic enthält language, queryOrRule, explanation', async () => {
    const draft = await stub.develop({});
    expect(draft.detectionLogic).toHaveProperty('language');
    expect(draft.detectionLogic).toHaveProperty('queryOrRule');
    expect(draft.detectionLogic).toHaveProperty('explanation');
  });

  test('mitre ist nicht-leeres Array mit tactic und technique', async () => {
    const draft = await stub.develop({});
    expect(Array.isArray(draft.mitre)).toBe(true);
    expect(draft.mitre.length).toBeGreaterThan(0);
    expect(draft.mitre[0]).toHaveProperty('tactic');
    expect(draft.mitre[0]).toHaveProperty('technique');
  });

  test('confidence liegt zwischen 0 und 100', async () => {
    const draft = await stub.develop({});
    expect(draft.confidence).toBeGreaterThanOrEqual(0);
    expect(draft.confidence).toBeLessThanOrEqual(100);
  });

  test('falsePositiveRisks ist nicht-leeres Array', async () => {
    const draft = await stub.develop({});
    expect(Array.isArray(draft.falsePositiveRisks)).toBe(true);
    expect(draft.falsePositiveRisks.length).toBeGreaterThan(0);
  });

  test('testCases enthält TP und FP', async () => {
    const draft = await stub.develop({});
    expect(Array.isArray(draft.testCases)).toBe(true);
    const types = draft.testCases.map((tc) => tc.type);
    expect(types).toContain('true_positive');
    expect(types).toContain('false_positive');
  });

  test('testCases-Events sind synthetisch (kein echter Hostname/User)', async () => {
    const draft = await stub.develop({});
    for (const tc of draft.testCases) {
      const eventStr = JSON.stringify(tc.event || {});
      // Darf keine echten IP-Adressen aus RFC-1918 enthalten die nach Produktionsnetz aussehen
      // (Dokumentations-IPs: 192.0.2.x, 198.51.100.x, 203.0.113.x sind erlaubt)
      expect(eventStr).not.toMatch(/\b10\.\d+\.\d+\.\d+\b/);
      expect(eventStr).not.toMatch(/nexora\.example/i);
    }
  });

  test('recommendedActions ist nicht-leeres Array', async () => {
    const draft = await stub.develop({});
    expect(Array.isArray(draft.recommendedActions)).toBe(true);
    expect(draft.recommendedActions.length).toBeGreaterThan(0);
  });

  test('playbookSteps ist nicht-leeres Array', async () => {
    const draft = await stub.develop({});
    expect(Array.isArray(draft.playbookSteps)).toBe(true);
    expect(draft.playbookSteps.length).toBeGreaterThan(0);
  });

  test('ist deterministisch — zwei Aufrufe liefern identisches Ergebnis', async () => {
    const d1 = await stub.develop({});
    const d2 = await stub.develop({ ticket: { id: 'unterschiedlich' } });
    expect(d1.title).toBe(d2.title);
    expect(d1.status).toBe(d2.status);
    expect(d1.generatedBy).toBe(d2.generatedBy);
  });
});
