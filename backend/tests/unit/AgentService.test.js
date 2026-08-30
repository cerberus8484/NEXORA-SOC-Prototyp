'use strict';

const { AgentService } = require('../../src/services/AgentService');
const { StubLlmProvider } = require('../../src/agents/providers/StubLlmProvider');
const { InMemoryAgentSuggestionRepository } = require('../../src/repositories/InMemoryAgentSuggestionRepository');

function svc(over = {}) {
  return new AgentService({
    repo: new InMemoryAgentSuggestionRepository(),
    provider: new StubLlmProvider(),
    minConfidence: 0.5,
    ...over,
  });
}

const TICKET = { id: 't1', title: 'PowerShell -enc', severity: 'high' };

describe('AgentService.propose()', () => {
  it('erzeugt pending Suggestion über den Provider', async () => {
    const s = await svc().propose({ ticket: TICKET, kind: 'triage' });
    expect(s.status).toBe('pending');
    expect(s.ticketId).toBe('t1');
    expect(s.proposal).toBeTruthy();
  });

  it('wirft 400 bei unbekanntem kind', async () => {
    await expect(svc().propose({ ticket: TICKET, kind: 'bogus' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('wirft 400 ohne ticket', async () => {
    await expect(svc().propose({ kind: 'triage' }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('AgentService — Approval-Workflow', () => {
  it('approve() setzt status approved', async () => {
    const s = svc();
    const created = await s.propose({ ticket: TICKET, kind: 'triage' });
    const approved = await s.approve(created.id, 'user-1');
    expect(approved.status).toBe('approved');
    expect(approved.reviewedBy).toBe('user-1');
  });

  it('reject() setzt status rejected', async () => {
    const s = svc();
    const created = await s.propose({ ticket: TICKET, kind: 'triage' });
    const rejected = await s.reject(created.id, 'user-1', 'FP');
    expect(rejected.status).toBe('rejected');
  });

  it('approve() auf unbekannter ID wirft 404', async () => {
    await expect(svc().approve('nope', 'u')).rejects.toMatchObject({ status: 404 });
  });

  it('approve() speist genehmigten Vorschlag in RAG ein (Lernschleife, best-effort)', async () => {
    const calls = [];
    const ragIncidentIngest = { ingestSuggestion: async (s) => { calls.push(s.id); } };
    const s = svc({ ragIncidentIngest });
    const created = await s.propose({ ticket: TICKET, kind: 'triage' });
    await s.approve(created.id, 'user-1');
    // Hook ist fire-and-forget → kurz auf Microtask warten
    await new Promise((r) => setImmediate(r));
    expect(calls).toContain(created.id);
  });

  it('approve() bricht NICHT, wenn RAG-Ingest fehlschlägt', async () => {
    const ragIncidentIngest = { ingestSuggestion: async () => { throw new Error('qdrant down'); } };
    const s = svc({ ragIncidentIngest });
    const created = await s.propose({ ticket: TICKET, kind: 'triage' });
    const approved = await s.approve(created.id, 'user-1'); // darf nicht werfen
    expect(approved.status).toBe('approved');
  });

  it('doppeltes approve wirft 409', async () => {
    const s = svc();
    const created = await s.propose({ ticket: TICKET, kind: 'triage' });
    await s.approve(created.id, 'user-1');
    await expect(s.approve(created.id, 'user-2')).rejects.toMatchObject({ status: 409 });
  });
});

describe('AgentService — 3 neue Kinds (evidence_explanation / mitre_mapping / next_steps)', () => {
  it('propose mit evidence_explanation erzeugt pending Suggestion', async () => {
    const s = await svc().propose({ ticket: TICKET, kind: 'evidence_explanation' });
    expect(s.status).toBe('pending');
    expect(s.kind).toBe('evidence_explanation');
    expect(s.proposal).toBeTruthy();
  });

  it('propose mit mitre_mapping erzeugt pending Suggestion', async () => {
    const s = await svc().propose({ ticket: TICKET, kind: 'mitre_mapping' });
    expect(s.status).toBe('pending');
    expect(s.kind).toBe('mitre_mapping');
    expect(s.proposal).toBeTruthy();
  });

  it('propose mit next_steps erzeugt pending Suggestion', async () => {
    const s = await svc().propose({ ticket: TICKET, kind: 'next_steps' });
    expect(s.status).toBe('pending');
    expect(s.kind).toBe('next_steps');
    expect(s.proposal).toBeTruthy();
  });
});

describe('AgentService — Listing & Audit', () => {
  it('listSuggestions filtert nach status', async () => {
    const s = svc();
    const a = await s.propose({ ticket: TICKET, kind: 'triage' });
    await s.propose({ ticket: TICKET, kind: 'action' });
    await s.approve(a.id, 'u');
    const pending = await s.listSuggestions({ status: 'pending' });
    expect(pending).toHaveLength(1);
    const approved = await s.listSuggestions({ status: 'approved' });
    expect(approved).toHaveLength(1);
  });

  it('schreibt Audit-Eintrag bei approve (wenn audit injiziert)', async () => {
    const calls = [];
    const audit = { write: async (e) => { calls.push(e); } };
    const s = svc({ audit });
    const created = await s.propose({ ticket: TICKET, kind: 'triage' });
    await s.approve(created.id, 'user-1', 'admin@soc');
    expect(calls.some((c) => /APPROVE/i.test(c.action))).toBe(true);
  });
});
