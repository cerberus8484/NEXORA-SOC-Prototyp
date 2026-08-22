'use strict';

const { evaluateThreshold, buildBaselineEvaluation } = require('../../src/domain/mlEvalBaseline');

describe('mlEvalBaseline', () => {
  test('evaluateThreshold berechnet coverage und agreement fuer outcome-faehige Rows', () => {
    expect(evaluateThreshold([
      { human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 },
      { human_label: 'incident', raw_verdict: 'suspicious', raw_confidence: 0.8 },
      { human_label: 'accepted', raw_verdict: 'incident', raw_confidence: 0.95 },
      { human_label: 'false_positive', raw_verdict: 'fp', raw_confidence: 0.4 },
    ], 0.7)).toEqual({
      threshold: 0.7,
      total: 4,
      comparable: 3,
      accepted: 2,
      routedToReview: 1,
      correct: 1,
      agreement: 0.5,
      coverage: 0.6667,
    });
  });

  test('blocked runs liefern bewusst keine Schein-Metriken', () => {
    const result = buildBaselineEvaluation({
      runManifest: {
        runName: 'blocked-run',
        status: 'blocked',
        blockers: ['routing_gate_fail'],
        gates: { routingGate: { selectedThreshold: null } },
      },
      splitRecordsByName: { train: [], validation: [], test: [] },
    });

    expect(result).toMatchObject({
      runName: 'blocked-run',
      status: 'blocked',
      blockers: ['routing_gate_fail'],
      selectedThreshold: null,
      splits: {},
    });
  });

  test('ready runs werden auf allen Splits ausgewertet', () => {
    const result = buildBaselineEvaluation({
      runManifest: {
        runName: 'ready-run',
        status: 'ready',
        blockers: [],
        gates: { routingGate: { selectedThreshold: 0.8 } },
      },
      splitRecordsByName: {
        train: [{ human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 }],
        validation: [{ human_label: 'false_positive', raw_verdict: 'fp', raw_confidence: 0.85 }],
        test: [{ human_label: 'incident', raw_verdict: 'suspicious', raw_confidence: 0.9 }],
      },
    });

    expect(result.status).toBe('ok');
    expect(result.selectedThreshold).toBe(0.8);
    expect(result.splits.train.agreement).toBe(1);
    expect(result.splits.validation.agreement).toBe(1);
    expect(result.splits.test.agreement).toBe(0);
  });
});
