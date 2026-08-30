'use strict';

const { AgentSuggestion } = require('../../src/domain/AgentSuggestion');
const { Ticket } = require('../../src/domain/Ticket');
const { InMemoryAgentSuggestionRepository } = require('../../src/repositories/InMemoryAgentSuggestionRepository');
const { InMemoryTicketRepository } = require('../../src/repositories/InMemoryTicketRepository');
const { MlEvalExportService } = require('../../src/services/MlEvalExportService');

describe('MlEvalExportService', () => {
  test('exportiert nur reviewed Suggestions und closed Tickets', async () => {
    const agentRepo = new InMemoryAgentSuggestionRepository();
    const ticketRepo = new InMemoryTicketRepository();
    const service = new MlEvalExportService({ agentSuggestionRepo: agentRepo, ticketRepo });

    await agentRepo.save(new AgentSuggestion({
      id: 'approved-1',
      ticketId: 't-1',
      proposal: 'ok',
      status: 'approved',
      reviewedAt: '2026-06-29T10:00:00Z',
    }));
    await agentRepo.save(new AgentSuggestion({
      id: 'pending-1',
      ticketId: 't-2',
      proposal: 'not reviewed',
      status: 'pending',
    }));
    await ticketRepo.save(new Ticket({
      id: 'closed-1',
      state: 'CLOSED',
      decision: 'incident',
      confidence: 91,
      updatedAt: '2026-06-29T10:00:00Z',
    }));
    await ticketRepo.save(new Ticket({ id: 'open-1', state: 'OPEN', decision: 'suspicious' }));

    const snapshot = await service.buildSnapshot({ include: 'all', limit: 50 });

    expect(snapshot.records.map((r) => r.entity_id).sort()).toEqual(['approved-1', 'closed-1']);
    expect(snapshot.counts).toEqual({ agent_suggestion: 1, ticket: 1 });
    expect(snapshot.returned).toBe(2);
    expect(snapshot).toMatchObject({
      schemaVersion: 'v1',
      recordCount: 2,
    });
    expect(snapshot.recordSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.labelSourceCounts).toEqual({
      agent_review: 1,
      ticket_outcome: 1,
    });
  });

  test('buildJsonl liefert schema-konforme parsebare Zeilen', async () => {
    const agentRepo = new InMemoryAgentSuggestionRepository();
    const service = new MlEvalExportService({ agentSuggestionRepo: agentRepo });
    await agentRepo.save(new AgentSuggestion({
      id: 'sg-jsonl',
      ticketId: 't-jsonl',
      proposal: 'ok',
      status: 'rejected',
      reviewedAt: '2026-06-29T10:00:00Z',
    }));

    const snapshot = await service.buildJsonl({ include: 'agent_suggestions', limit: 10 });

    const parsed = snapshot.body.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ schema_version: 'v1', entity_type: 'agent_suggestion' });
    expect(snapshot.recordSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('limit deckelt den Gesamtexport ueber alle Quellen', async () => {
    const agentRepo = new InMemoryAgentSuggestionRepository();
    const ticketRepo = new InMemoryTicketRepository();
    const service = new MlEvalExportService({ agentSuggestionRepo: agentRepo, ticketRepo });

    await agentRepo.save(new AgentSuggestion({ id: 'sg-1', ticketId: 't-1', proposal: 'ok', status: 'approved' }));
    await agentRepo.save(new AgentSuggestion({ id: 'sg-2', ticketId: 't-2', proposal: 'ok', status: 'rejected' }));
    await ticketRepo.save(new Ticket({ id: 't-3', state: 'CLOSED', decision: 'incident' }));

    const snapshot = await service.buildSnapshot({ include: 'all', limit: 2 });

    expect(snapshot.returned).toBe(2);
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.exportLimit).toBe(2);
  });
});
