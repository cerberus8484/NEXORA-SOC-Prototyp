'use strict';

const { AgentSuggestion } = require('../../src/domain/AgentSuggestion');
const { Ticket } = require('../../src/domain/Ticket');
const {
  mapAgentSuggestionToEvalRecord,
  mapTicketToEvalRecord,
  buildSnapshotDigest,
  buildSnapshotMeta,
  normalizeConfidence,
  toJsonl,
} = require('../../src/domain/mlEvalSnapshot');

describe('mlEvalSnapshot', () => {
  test('mappt reviewed AgentSuggestion auf v1 Eval-Record ohne Proposal/Rationale/Reviewer-PII', () => {
    const suggestion = new AgentSuggestion({
      id: 'sg-1',
      ticketId: 'ticket-1',
      kind: 'triage',
      proposal: 'Sensitive proposal must not be exported',
      rationale: 'Sensitive rationale must not be exported',
      verdict: 'suspicious',
      confidence: 0.82,
      status: 'rejected',
      model: 'ollama:llama3.2:3b',
      reviewedBy: 'user-123',
      reviewReason: 'Zu wenig Beleg\nweitere Analyse noetig',
      createdAt: '2026-06-29T09:10:00.000Z',
      reviewedAt: '2026-06-29T09:14:00.000Z',
    });

    const record = mapAgentSuggestionToEvalRecord(suggestion);

    expect(record).toMatchObject({
      schema_version: 'v1',
      entity_type: 'agent_suggestion',
      entity_id: 'sg-1',
      ticket_id: 'ticket-1',
      label_source: 'agent_review',
      source_kind: 'agent_review',
      kind: 'triage',
      source_system: 'agent',
      source_model: 'ollama:llama3.2:3b',
      raw_verdict: 'suspicious',
      raw_confidence: 0.82,
      review_status: 'rejected',
      human_label: 'rejected',
      human_reason: 'Zu wenig Beleg weitere Analyse noetig',
    });
    expect(record).not.toHaveProperty('proposal');
    expect(record).not.toHaveProperty('rationale');
    expect(record).not.toHaveProperty('reviewed_by');
  });

  test('mappt closed Ticket auf Outcome-Label und normalisiert Confidence 0..100 auf 0..1', () => {
    const ticket = new Ticket({
      id: 't-1',
      source: 'wazuh',
      kind: 'alert',
      state: 'CLOSED',
      closeReason: 'false_positive',
      decision: 'fp',
      confidence: 67,
      priority: 'low',
      title: 'Sensitive host user title must not be exported',
      createdAt: '2026-06-28T13:20:00.000Z',
      updatedAt: '2026-06-28T15:02:00.000Z',
    });

    const record = mapTicketToEvalRecord(ticket);

    expect(record).toMatchObject({
      schema_version: 'v1',
      entity_type: 'ticket',
      entity_id: 't-1',
      ticket_id: 't-1',
      label_source: 'ticket_outcome',
      source_kind: 'ticket_close',
      source_system: 'wazuh',
      raw_verdict: 'fp',
      raw_confidence: 0.67,
      review_status: 'CLOSED',
      human_label: 'false_positive',
      close_reason: 'false_positive',
      priority: 'low',
    });
    expect(record).not.toHaveProperty('title');
    expect(record).not.toHaveProperty('description');
    expect(record).not.toHaveProperty('notes');
  });

  test('clamped Confidence und JSONL sind robust parsebar', () => {
    expect(normalizeConfidence(150, 100)).toBe(1);
    expect(normalizeConfidence(-1)).toBe(0);
    expect(normalizeConfidence('nope')).toBeNull();

    const line = toJsonl([{ schema_version: 'v1', human_label: 'accepted' }]);
    expect(JSON.parse(line.trim())).toEqual({ schema_version: 'v1', human_label: 'accepted' });
  });

  test('Snapshot-Meta liefert stabile Digest- und Label-Metadaten', () => {
    const records = [
      { schema_version: 'v1', label_source: 'agent_review', human_label: 'accepted' },
      { schema_version: 'v1', label_source: 'ticket_outcome', human_label: 'incident' },
      { schema_version: 'v1', label_source: 'ticket_outcome', human_label: 'incident' },
    ];

    expect(buildSnapshotDigest(records)).toHaveLength(64);
    expect(buildSnapshotDigest(records)).toBe(buildSnapshotDigest(records));
    expect(buildSnapshotMeta(records, { generatedAt: '2026-06-29T12:00:00Z' })).toEqual({
      schemaVersion: 'v1',
      generatedAt: '2026-06-29T12:00:00.000Z',
      recordCount: 3,
      recordSha256: buildSnapshotDigest(records),
      labelSourceCounts: {
        agent_review: 1,
        ticket_outcome: 2,
      },
      humanLabelCounts: {
        accepted: 1,
        incident: 2,
      },
    });
  });
});
