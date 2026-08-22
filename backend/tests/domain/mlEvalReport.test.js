'use strict';

const {
  parseJsonl,
  validateEvalRecords,
  buildOutcomeAgreement,
  buildThresholdSweep,
  evaluateRoutingGate,
  buildGoldSummary,
  summarizeEvalRecords,
  renderMarkdownReport,
} = require('../../src/domain/mlEvalReport');

const SAMPLE = [
  {
    schema_version: 'v1',
    entity_type: 'agent_suggestion',
    entity_id: 'sg-1',
    ticket_id: 't-1',
    label_source: 'agent_review',
    source_kind: 'agent_review',
    kind: 'triage',
    source_system: 'agent',
    source_model: 'stub',
    raw_verdict: 'suspicious',
    raw_confidence: 0.8,
    review_status: 'approved',
    human_label: 'accepted',
    human_reason: '',
    close_reason: '',
    priority: 'high',
    created_at: '2026-06-29T10:00:00Z',
    reviewed_at: '2026-06-29T10:01:00Z',
  },
  {
    schema_version: 'v1',
    entity_type: 'ticket',
    entity_id: 't-2',
    ticket_id: 't-2',
    label_source: 'ticket_outcome',
    source_kind: 'ticket_close',
    kind: 'alert',
    source_system: 'wazuh',
    source_model: '',
    raw_verdict: 'incident',
    raw_confidence: 0.91,
    review_status: 'CLOSED',
    human_label: 'incident',
    human_reason: '',
    close_reason: 'resolved',
    priority: 'critical',
    created_at: '2026-06-29T10:00:00Z',
    reviewed_at: '2026-06-29T11:00:00Z',
  },
  {
    schema_version: 'v1',
    entity_type: 'ticket',
    entity_id: 't-3',
    ticket_id: 't-3',
    label_source: 'ticket_outcome',
    source_kind: 'ticket_close',
    kind: 'alert',
    source_system: 'wazuh',
    source_model: '',
    raw_verdict: 'fp',
    raw_confidence: 0.67,
    review_status: 'CLOSED',
    human_label: 'false_positive',
    human_reason: '',
    close_reason: 'false_positive',
    priority: 'low',
    created_at: '2026-06-29T10:00:00Z',
    reviewed_at: '2026-06-29T11:00:00Z',
  },
  {
    schema_version: 'v1',
    entity_type: 'ticket',
    entity_id: 'gold-1',
    ticket_id: 'gold-1',
    label_source: 'gold_review',
    source_kind: 'gold_sample',
    kind: 'alert',
    source_system: 'wazuh',
    source_model: '',
    raw_verdict: 'suspicious',
    raw_confidence: 0.71,
    review_status: 'CLOSED',
    human_label: 'incident',
    human_reason: 'Gold review: escalation evidence confirmed after manual adjudication',
    close_reason: 'resolved',
    priority: 'high',
    created_at: '2026-06-29T10:00:00Z',
    reviewed_at: '2026-06-29T12:00:00Z',
  },
];

describe('mlEvalReport', () => {
  test('parseJsonl liest mehrere Records und meldet kaputte Zeilen explizit', () => {
    const text = `${JSON.stringify(SAMPLE[0])}\n\n${JSON.stringify(SAMPLE[1])}\n`;
    expect(parseJsonl(text)).toHaveLength(2);

    expect(() => parseJsonl('{"ok":true}\n{broken')).toThrow('Invalid JSONL at line 2');
  });

  test('validateEvalRecords findet Schema-, Label- und Confidence-Probleme', () => {
    const warnings = validateEvalRecords([
      { schema_version: 'v0', entity_type: '', entity_id: '', human_label: 'maybe', raw_confidence: 4 },
    ]);

    expect(warnings.map((w) => w.code)).toEqual([
      'schema_version',
      'entity_type_missing',
      'entity_id_missing',
      'human_label_unknown',
      'raw_confidence_range',
    ]);
  });

  test('summarizeEvalRecords erzeugt Slices und Raw-Verdict-vs-Label-Matrix', () => {
    const summary = summarizeEvalRecords(SAMPLE);

    expect(summary.total).toBe(4);
    expect(summary.warnings).toEqual([]);
    expect(summary.confidence).toMatchObject({ count: 4, min: 0.67, max: 0.91, mean: 0.7725 });
    expect(summary.slices.entity_type).toEqual([
      { value: 'ticket', count: 3 },
      { value: 'agent_suggestion', count: 1 },
    ]);
    expect(summary.slices.source_system).toEqual([
      { value: 'wazuh', count: 3 },
      { value: 'agent', count: 1 },
    ]);
    expect(summary.confusion).toEqual([
      { rawVerdict: 'fp', labels: [{ value: 'false_positive', count: 1 }] },
      { rawVerdict: 'incident', labels: [{ value: 'incident', count: 1 }] },
      { rawVerdict: 'suspicious', labels: [{ value: 'accepted', count: 1 }, { value: 'incident', count: 1 }] },
    ]);
    expect(summary.outcomeAgreement).toMatchObject({
      comparable: 3,
      correct: 2,
      skipped: 1,
      agreement: 0.6667,
    });
    expect(summary.gold).toMatchObject({
      total: 1,
      outcomeAgreement: {
        comparable: 1,
        correct: 0,
        skipped: 0,
        agreement: 0,
      },
    });
    expect(summary.routingGate).toMatchObject({
      status: 'fail',
      gate: { minAgreement: 0.8, minCoverage: 0.5, minGoldRecords: 20 },
    });
    expect(summary.routingGate.failures).toContain('gold_records 1 < 20');
    expect(summary.thresholdSweep).toEqual([
      { threshold: 0, comparable: 3, accepted: 3, correct: 2, routedToReview: 0, coverage: 1, agreement: 0.6667 },
      { threshold: 0.5, comparable: 3, accepted: 3, correct: 2, routedToReview: 0, coverage: 1, agreement: 0.6667 },
      { threshold: 0.7, comparable: 3, accepted: 2, correct: 1, routedToReview: 1, coverage: 0.6667, agreement: 0.5 },
      { threshold: 0.9, comparable: 3, accepted: 1, correct: 1, routedToReview: 2, coverage: 0.3333, agreement: 1 },
    ]);
  });

  test('buildOutcomeAgreement vergleicht nur outcome-faehige Labels', () => {
    const agreement = buildOutcomeAgreement([
      { raw_verdict: 'suspicious', human_label: 'incident' },
      { raw_verdict: 'false_positive', human_label: 'false_positive' },
      { raw_verdict: 'suspicious', human_label: 'accepted' },
      { raw_verdict: '', human_label: 'benign' },
    ]);

    expect(agreement).toMatchObject({
      comparable: 2,
      correct: 1,
      skipped: 2,
      agreement: 0.5,
    });
    expect(agreement.matrix).toEqual([
      { predicted: 'false_positive', labels: [{ value: 'false_positive', count: 1 }] },
      { predicted: 'suspicious', labels: [{ value: 'incident', count: 1 }] },
    ]);
  });

  test('buildThresholdSweep zeigt Coverage und Review-Routing je Schwelle', () => {
    const sweep = buildThresholdSweep([
      { raw_verdict: 'incident', human_label: 'incident', raw_confidence: 0.95 },
      { raw_verdict: 'suspicious', human_label: 'incident', raw_confidence: 0.75 },
      { raw_verdict: 'fp', human_label: 'false_positive', raw_confidence: 0.4 },
      { raw_verdict: 'incident', human_label: 'accepted', raw_confidence: 0.99 },
      { raw_verdict: 'benign', human_label: 'benign', raw_confidence: null },
    ], [0.5, 0.8]);

    expect(sweep).toEqual([
      { threshold: 0.5, comparable: 4, accepted: 2, correct: 1, routedToReview: 2, coverage: 0.5, agreement: 0.5 },
      { threshold: 0.8, comparable: 4, accepted: 1, correct: 1, routedToReview: 3, coverage: 0.25, agreement: 1 },
    ]);
  });

  test('evaluateRoutingGate ist fail-closed und waehlt nur tragfaehige Gold-Schwellen', () => {
    const goldSummary = {
      total: 4,
      thresholdSweep: [
        { threshold: 0.5, accepted: 4, agreement: 0.75, coverage: 1 },
        { threshold: 0.7, accepted: 2, agreement: 1, coverage: 0.5 },
        { threshold: 0.9, accepted: 0, agreement: null, coverage: 0 },
      ],
    };

    expect(evaluateRoutingGate({ goldSummary })).toMatchObject({
      status: 'fail',
      selected: null,
    });
    expect(evaluateRoutingGate({
      goldSummary,
      gate: { minAgreement: 0.8, minCoverage: 0.5, minGoldRecords: 4 },
    })).toMatchObject({
      status: 'pass',
      selected: { threshold: 0.7 },
      failures: [],
    });
  });



  test('Gold-Subset braucht Outcome-Label, Raw-Verdict, Review-Zeit und Grund', () => {
    const warnings = validateEvalRecords([
      {
        schema_version: 'v1',
        entity_type: 'ticket',
        entity_id: 'gold-bad',
        human_label: 'accepted',
        raw_verdict: 'needs_more_info',
        label_source: 'gold_review',
      },
    ]);

    expect(warnings.map((w) => w.code)).toEqual([
      'gold_human_label_not_outcome',
      'gold_raw_verdict_not_outcome',
      'gold_reviewed_at_missing',
      'gold_human_reason_missing',
    ]);
  });

  test('buildGoldSummary wertet nur label_source=gold_review aus', () => {
    const gold = buildGoldSummary(SAMPLE);

    expect(gold.total).toBe(1);
    expect(gold.outcomeAgreement).toMatchObject({
      comparable: 1,
      correct: 0,
      agreement: 0,
    });
    expect(gold.slices.source_system).toEqual([{ value: 'wazuh', count: 1 }]);
  });

  test('renderMarkdownReport ist stabil lesbar', () => {
    const markdown = renderMarkdownReport(summarizeEvalRecords(SAMPLE));

    expect(markdown).toContain('# Nexora ML Eval Report');
    expect(markdown).toContain('Records: 4');
    expect(markdown).toContain('### source_system');
    expect(markdown).toContain('- suspicious: accepted=1');
    expect(markdown).toContain('## Outcome Agreement');
    expect(markdown).toContain('## Threshold Sweep');
    expect(markdown).toContain('>=0.7: accepted=2/3');
    expect(markdown).toContain('## Gold Review Subset');
    expect(markdown).toContain('## Routing Gate');
    expect(markdown).toContain('Status: fail');
  });
});
