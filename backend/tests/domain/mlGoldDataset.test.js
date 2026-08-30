'use strict';

const { mergeGoldRecords, buildGoldMergeResult } = require('../../src/domain/mlGoldDataset');

describe('mlGoldDataset', () => {
  test('mergeGoldRecords ersetzt gleiche entity_id deterministisch', () => {
    const merged = mergeGoldRecords(
      [{ entity_id: 'gold-1', human_label: 'incident' }, { entity_id: 'gold-2', human_label: 'benign' }],
      [{ entity_id: 'gold-2', human_label: 'false_positive' }, { entity_id: 'gold-3', human_label: 'incident' }],
    );

    expect(merged).toEqual([
      { entity_id: 'gold-1', human_label: 'incident' },
      { entity_id: 'gold-2', human_label: 'false_positive' },
      { entity_id: 'gold-3', human_label: 'incident' },
    ]);
  });

  test('buildGoldMergeResult validiert und serialisiert das Merge-Ergebnis', () => {
    const result = buildGoldMergeResult({
      baseText: `${JSON.stringify({
        schema_version: 'v1',
        entity_type: 'ticket',
        entity_id: 'gold-1',
        ticket_id: 'gold-1',
        label_source: 'gold_review',
        source_kind: 'gold_sample',
        kind: 'alert',
        source_system: 'wazuh',
        source_model: '',
        raw_verdict: 'incident',
        raw_confidence: 0.9,
        review_status: 'CLOSED',
        human_label: 'incident',
        human_reason: 'Gold review: confirmed',
        close_reason: 'resolved',
        priority: 'high',
        created_at: '2026-06-29T08:00:00Z',
        reviewed_at: '2026-06-29T09:00:00Z',
      })}\n`,
      incomingText: `${JSON.stringify({
        schema_version: 'v1',
        entity_type: 'ticket',
        entity_id: 'gold-2',
        ticket_id: 'gold-2',
        label_source: 'gold_review',
        source_kind: 'gold_sample',
        kind: 'alert',
        source_system: 'manual',
        source_model: '',
        raw_verdict: 'benign',
        raw_confidence: 0.7,
        review_status: 'CLOSED',
        human_label: 'benign',
        human_reason: 'Gold review: approved admin action',
        close_reason: 'benign',
        priority: 'medium',
        created_at: '2026-06-29T10:00:00Z',
        reviewed_at: '2026-06-29T10:30:00Z',
      })}\n`,
    });

    expect(result.baseRecords).toHaveLength(1);
    expect(result.incomingRecords).toHaveLength(1);
    expect(result.mergedRecords).toHaveLength(2);
    expect(result.warnings.base).toEqual([]);
    expect(result.warnings.incoming).toEqual([]);
    expect(result.warnings.merged).toEqual([]);
    expect(result.output).toContain('"entity_id":"gold-1"');
    expect(result.output).toContain('"entity_id":"gold-2"');
  });
});
