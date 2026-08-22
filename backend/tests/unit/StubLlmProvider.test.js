'use strict';

const { StubLlmProvider } = require('../../src/agents/providers/StubLlmProvider');

describe('StubLlmProvider — deterministischer Vorschlag (kein externes LLM)', () => {
  const provider = new StubLlmProvider();
  const ticket = { id: 't1', title: 'Verdächtige PowerShell', severity: 'high', offenseId: 'wazuh:rule:5710' };

  it('liefert proposal, rationale, confidence', async () => {
    const out = await provider.propose({ ticket, kind: 'triage' });
    expect(out.proposal).toBeTruthy();
    expect(out.rationale).toBeTruthy();
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });

  it('ist deterministisch — gleiche Eingabe, gleiche Ausgabe', async () => {
    const a = await provider.propose({ ticket, kind: 'triage' });
    const b = await provider.propose({ ticket, kind: 'triage' });
    expect(a).toEqual(b);
  });

  it('höhere Severity → höhere Confidence', async () => {
    const low  = await provider.propose({ ticket: { ...ticket, severity: 'low' },  kind: 'triage' });
    const high = await provider.propose({ ticket: { ...ticket, severity: 'critical' }, kind: 'triage' });
    expect(high.confidence).toBeGreaterThan(low.confidence);
  });

  it('reportet sein Modell-Label', () => {
    expect(provider.name).toMatch(/stub/i);
  });
});

describe('StubLlmProvider — 3 neue Kinds (evidence_explanation / mitre_mapping / next_steps)', () => {
  const provider = new StubLlmProvider();
  const ticket = { id: 't1', title: 'Verdächtige PowerShell', severity: 'high' };

  it('evidence_explanation liefert distinktiven Proposal (kein triage-Fallback)', async () => {
    const out = await provider.propose({ ticket, kind: 'evidence_explanation' });
    expect(out.proposal).toBeTruthy();
    const triage = await provider.propose({ ticket, kind: 'triage' });
    expect(out.proposal).not.toBe(triage.proposal);
  });

  it('mitre_mapping liefert distinktiven Proposal (kein triage-Fallback)', async () => {
    const out = await provider.propose({ ticket, kind: 'mitre_mapping' });
    expect(out.proposal).toBeTruthy();
    const triage = await provider.propose({ ticket, kind: 'triage' });
    expect(out.proposal).not.toBe(triage.proposal);
  });

  it('next_steps liefert distinktiven Proposal (kein triage-Fallback)', async () => {
    const out = await provider.propose({ ticket, kind: 'next_steps' });
    expect(out.proposal).toBeTruthy();
    const triage = await provider.propose({ ticket, kind: 'triage' });
    expect(out.proposal).not.toBe(triage.proposal);
  });

  it('alle 3 neuen Kinds liefern verdict = "" (keine Risikoeinstufung)', async () => {
    for (const kind of ['evidence_explanation', 'mitre_mapping', 'next_steps']) {
      const out = await provider.propose({ ticket, kind });
      expect(out.verdict).toBe('');
    }
  });

  it('confidence richtet sich nach Severity (deterministisch)', async () => {
    const low  = await provider.propose({ ticket: { ...ticket, severity: 'low' },  kind: 'evidence_explanation' });
    const high = await provider.propose({ ticket: { ...ticket, severity: 'critical' }, kind: 'evidence_explanation' });
    expect(high.confidence).toBeGreaterThan(low.confidence);
  });

  it('die 3 neuen Kinds sind untereinander distinkt', async () => {
    const ev   = await provider.propose({ ticket, kind: 'evidence_explanation' });
    const mitre = await provider.propose({ ticket, kind: 'mitre_mapping' });
    const next  = await provider.propose({ ticket, kind: 'next_steps' });
    expect(ev.proposal).not.toBe(mitre.proposal);
    expect(ev.proposal).not.toBe(next.proposal);
    expect(mitre.proposal).not.toBe(next.proposal);
  });
});
