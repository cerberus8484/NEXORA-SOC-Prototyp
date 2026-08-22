'use strict';

const { buildThresholdComparison, rankThresholds } = require('../../src/domain/mlEvalThresholdComparison');

describe('mlEvalThresholdComparison', () => {
  test('rankThresholds bevorzugt validation agreement dann coverage', () => {
    const ranked = rankThresholds([
      { threshold: 0.7, validation: { agreement: 1, coverage: 0.5 } },
      { threshold: 0, validation: { agreement: 1, coverage: 1 } },
      { threshold: 0.9, validation: { agreement: null, coverage: 0 } },
    ]);
    expect(ranked.map((row) => row.threshold)).toEqual([0, 0.7, 0.9]);
  });

  test('blocked runs liefern keine schein-empfehlung', () => {
    const result = buildThresholdComparison({
      runManifest: { runName: 'blocked', status: 'blocked', blockers: ['routing_gate_fail'] },
      splitRecordsByName: { train: [], validation: [], test: [] },
    });
    expect(result).toMatchObject({
      runName: 'blocked',
      status: 'blocked',
      recommendedThreshold: null,
    });
  });

  test('ready runs liefern validation-basierte threshold-empfehlung', () => {
    const result = buildThresholdComparison({
      runManifest: { runName: 'ready', status: 'ready', blockers: [] },
      splitRecordsByName: {
        train: [
          { human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 },
          { human_label: 'false_positive', raw_verdict: 'fp', raw_confidence: 0.8 },
        ],
        validation: [
          { human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 },
          { human_label: 'false_positive', raw_verdict: 'fp', raw_confidence: 0.6 },
        ],
        test: [
          { human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.95 },
          { human_label: 'incident', raw_verdict: 'suspicious', raw_confidence: 0.7 },
        ],
      },
      thresholds: [0, 0.7, 0.9],
    });

    expect(result.status).toBe('ok');
    expect(result.recommendedThreshold).toBe(0);
    expect(result.thresholds).toHaveLength(3);
  });
});
