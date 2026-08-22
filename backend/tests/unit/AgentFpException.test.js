'use strict';

const { AgentService } = require('../../src/services/AgentService');
const { InMemoryAgentSuggestionRepository } = require('../../src/repositories/InMemoryAgentSuggestionRepository');

// Provider-Fake mit steuerbarem verdict.
function provider(verdict) {
  return { propose: async () => ({ proposal: 'P', rationale: 'R', verdict, confidence: 0.8, model: 'fake' }) };
}

function build({ verdict = 'false_positive', ticketSource = 'wazuh', builderResult } = {}) {
  const updates = [];
  const ticketService = {
    findById: async (id) => ({ id, source: ticketSource, notes: '' }),
    update: async (id, body) => { updates.push({ id, body }); return { id, ...body }; },
  };
  const fpCalls = [];
  const fpExceptionBuilder = (ticket, context) => {
    fpCalls.push({ ticketId: ticket.id, context });
    if (builderResult !== undefined) return builderResult;
    return { scope: { ruleId: '5710', agentId: '001' }, xml: '<group><rule id="100001">...</rule></group>', ruleId: '100001', warnings: [] };
  };
  const auditEvents = [];
  const audit = { write: async (e) => { auditEvents.push(e); } };
  const svc = new AgentService({
    repo: new InMemoryAgentSuggestionRepository(),
    provider: provider(verdict),
    ticketService, fpExceptionBuilder, audit,
  });
  return { svc, updates, fpCalls, auditEvents };
}

describe('AgentService — Auto-FP-Regel beim Genehmigen', () => {
  it('propose speichert verdict', async () => {
    const { svc } = build();
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'triage' });
    expect(s.verdict).toBe('false_positive');
  });

  it('genehmigter FP-Triage → FP-Regel-Vorschau als Ticket-Notiz', async () => {
    const { svc, updates, fpCalls } = build({ verdict: 'false_positive' });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'triage' });
    await svc.approve(s.id, 'admin-1');
    expect(fpCalls.map((c) => c.ticketId)).toEqual(['t1']);
    expect(updates).toHaveLength(1);
    expect(updates[0].body.notes).toMatch(/FP-Exception/i);
    expect(updates[0].body.notes).toMatch(/rule id="100001"/);
    expect(updates[0].body.notes).toMatch(/NICHT angewendet/i);
  });

  it('Builder bekommt die Begründung aus dem genehmigten Vorschlag (reason-Kontext)', async () => {
    const { svc, fpCalls } = build({ verdict: 'false_positive' });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'triage' });
    await svc.approve(s.id, 'admin-1');
    expect(fpCalls[0].context.reason).toMatch(/False-positive review approved by analyst/);
    expect(fpCalls[0].context.reason).toContain('P'); // Proposal-Kurzfassung enthalten
  });

  it('Builder-Warnungen (z.B. Agent-Scope) landen in der Ticket-Notiz', async () => {
    const { svc, updates } = build({
      verdict: 'false_positive',
      builderResult: {
        scope: { ruleId: '52502', agentId: '005', agentName: 'Proxmox' },
        xml: '<group><rule id="900100">...</rule></group>', ruleId: 900100,
        warnings: ['Agent-Scope via <hostname>Proxmox</hostname> — Matching vor dem Anwenden mit wazuh-logtest verifizieren.'],
      },
    });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'triage' });
    await svc.approve(s.id, 'admin-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].body.notes).toMatch(/⚠ Agent-Scope via/);
  });

  it('SILENT-FAIL WEG (F): Builder liefert keinen Scope → Audit-Skip-Eintrag statt Verschwinden', async () => {
    const { svc, updates, auditEvents } = build({
      verdict: 'false_positive',
      builderResult: { skipped: true, errors: ['missing scoped selector'] },
    });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'triage' });
    const approved = await svc.approve(s.id, 'admin-1');   // approve selbst bleibt ok
    expect(approved.status).toBe('approved');
    expect(updates).toHaveLength(0);                        // keine Notiz
    const skip = auditEvents.find((e) => e.action === 'AGENT_FP_EXCEPTION_SKIPPED');
    expect(skip).toBeDefined();
    expect(skip.targetId).toBe('t1');
    expect(skip.metadata.errors).toEqual(['missing scoped selector']);
  });

  it('false_positive_review genehmigt → FP-Vorschau auch wenn KI-Verdict needs_more_info', async () => {
    const { svc, updates, fpCalls } = build({ verdict: 'needs_more_info' });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'false_positive_review' });
    await svc.approve(s.id, 'admin-1');
    // Analyst hat durch Genehmigung die FP-Entscheidung getroffen — Preview muss feuern.
    expect(fpCalls).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].body.notes).toMatch(/FP-Exception/i);
    expect(updates[0].body.notes).toMatch(/NICHT angewendet/i);
  });

  it('false_positive_review genehmigt → FP-Vorschau auch wenn KI-Verdict suspicious', async () => {
    const { svc, updates, fpCalls } = build({ verdict: 'suspicious' });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'false_positive_review' });
    await svc.approve(s.id, 'admin-1');
    expect(fpCalls).toHaveLength(1);
    expect(updates).toHaveLength(1);
  });

  it('genehmigter NICHT-FP-Triage-Vorschlag → keine Regel', async () => {
    const { svc, updates } = build({ verdict: 'suspicious' });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'triage' });
    await svc.approve(s.id, 'admin-1');
    expect(updates).toHaveLength(0);
  });

  it('FP, aber Ticket nicht von Wazuh → keine Regel', async () => {
    const { svc, updates } = build({ verdict: 'false_positive', ticketSource: 'manual' });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'triage' });
    await svc.approve(s.id, 'admin-1');
    expect(updates).toHaveLength(0);
  });

  it('approve bleibt robust, wenn FP-Builder wirft', async () => {
    const svc = new AgentService({
      repo: new InMemoryAgentSuggestionRepository(),
      provider: provider('false_positive'),
      ticketService: { findById: async (id) => ({ id, source: 'wazuh', notes: '' }), update: async () => { throw new Error('boom'); } },
      fpExceptionBuilder: () => { throw new Error('builder kaputt'); },
    });
    const s = await svc.propose({ ticket: { id: 't1' }, kind: 'triage' });
    const approved = await svc.approve(s.id, 'admin-1');   // darf NICHT werfen
    expect(approved.status).toBe('approved');
  });
});
