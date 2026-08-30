'use strict';

const { PublishedDetection } = require('../../src/domain/PublishedDetection');

// ─── Hilfsfunktion ────────────────────────────────────────────────────────────

function makeDraft() {
  return {
    id:          'draft-uuid-001',
    title:       'Lateral Movement via WMI',
    sourceType:  'ticket',
    sourceId:    'INC000001',
    severity:    'high',
    mitre:       [{ tactic: 'lateral_movement', technique: 'T1047' }],
    detectionLogic: {
      language:    'wazuh',
      queryOrRule: 'rule.groups: wmi AND process.name: wmiprvse.exe',
      explanation: 'WMI-Provider-Host spawnt ungewöhnliche Kindprozesse',
    },
    // testCases trägt potenziell PII — darf NICHT in den Snapshot!
    testCases: [
      { name: 'WMI-Spawn', type: 'true_positive', event: { host: '192.168.241.10', user: 'jdoe' } },
    ],
  };
}

// ─── Domain: PublishedDetection.create() ──────────────────────────────────────

describe('PublishedDetection — create()', () => {
  it('vergibt eine UUID', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('übernimmt draftId aus dem Draft', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.draftId).toBe('draft-uuid-001');
  });

  it('snapshoted rule = detectionLogic.queryOrRule', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.rule).toBe('rule.groups: wmi AND process.name: wmiprvse.exe');
  });

  it('snapshoted explanation = detectionLogic.explanation', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.explanation).toBe('WMI-Provider-Host spawnt ungewöhnliche Kindprozesse');
  });

  it('snapshoted language = detectionLogic.language', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.language).toBe('wazuh');
  });

  it('snapshoted title', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.title).toBe('Lateral Movement via WMI');
  });

  it('snapshoted severity', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.severity).toBe('high');
  });

  it('snapshoted mitre array (deep copy, keine geteilte Referenz)', () => {
    const draft = makeDraft();
    const pd    = PublishedDetection.create(draft, 'admin@nexora.example');
    expect(pd.mitre).toEqual([{ tactic: 'lateral_movement', technique: 'T1047' }]);
    // keine geteilte Referenz
    draft.mitre.push({ tactic: 'other', technique: 'T9999' });
    expect(pd.mitre).toHaveLength(1);
  });

  it('snapshoted sourceType und sourceId', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.sourceType).toBe('ticket');
    expect(pd.sourceId).toBe('INC000001');
  });

  it('setzt publishedBy auf den übergebenen Actor', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.publishedBy).toBe('admin@nexora.example');
  });

  it('setzt createdAt als ISO-Timestamp', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ─── DSGVO-Pflichttest ────────────────────────────────────────────────────
  // testCases können rohe PII enthalten (IPs, Hostnamen, User-IDs) — NIEMALS snapshoten.
  it('DSGVO: enthält KEINE testCases (kein PII-Snapshot)', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd).not.toHaveProperty('testCases');
    const json = pd.toJSON();
    expect(json).not.toHaveProperty('testCases');
  });

  it('DSGVO: enthält keine description (freier Text kann PII tragen)', () => {
    const pd = PublishedDetection.create(makeDraft(), 'admin@nexora.example');
    expect(pd).not.toHaveProperty('description');
  });

  it('Fallback: leere detectionLogic → rule und explanation leer', () => {
    const draft = { ...makeDraft(), detectionLogic: null };
    const pd    = PublishedDetection.create(draft, 'u');
    expect(pd.rule).toBe('');
    expect(pd.explanation).toBe('');
    expect(pd.language).toBe('generic');
  });

  it('Fallback: fehlende mitre → leeres Array', () => {
    const draft = { ...makeDraft(), mitre: undefined };
    const pd    = PublishedDetection.create(draft, 'u');
    expect(Array.isArray(pd.mitre)).toBe(true);
    expect(pd.mitre).toHaveLength(0);
  });
});

// ─── toJSON ──────────────────────────────────────────────────────────────────

describe('PublishedDetection — toJSON()', () => {
  it('gibt alle Public-Felder zurück', () => {
    const pd = PublishedDetection.create(makeDraft(), 'u');
    const j  = pd.toJSON();
    expect(j.id).toBe(pd.id);
    expect(j.draftId).toBe('draft-uuid-001');
    expect(j.rule).toBeTruthy();
    expect(j.language).toBe('wazuh');
  });

  it('Mutation des toJSON-Ergebnisses ändert Instanz nicht', () => {
    const pd = PublishedDetection.create(makeDraft(), 'u');
    const j  = pd.toJSON();
    j.title = 'Mutiert';
    expect(pd.title).toBe('Lateral Movement via WMI');
  });
});
