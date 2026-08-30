'use strict';

const {
  rankThresholdsConservative,
  buildThresholdComparison,
} = require('../../src/domain/mlEvalThresholdComparison');

describe('mlEval policy comparison', () => {
  test('conservative ranking bevorzugt bei kleinem agreement-tie die hoehere schwelle', () => {
    const ranked = rankThresholdsConservative([
      { threshold: 0, validation: { agreement: 1, coverage: 1 } },
      { threshold: 0.7, validation: { agreement: 1, coverage: 1 } },
      { threshold: 0.9, validation: { agreement: 1, coverage: 0.5 } },
    ]);
    expect(ranked.map((row) => row.threshold)).toEqual([0.7, 0, 0.9]);
  });

  test('buildThresholdComparison exposes selected policy', () => {
    const result = buildThresholdComparison({
      runManifest: { runName: 'ready', status: 'ready', blockers: [] },
      splitRecordsByName: {
        train: [{ human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 }],
        validation: [
          { human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 },
          { human_label: 'false_positive', raw_verdict: 'fp', raw_confidence: 0.7 },
        ],
        test: [{ human_label: 'incident', raw_verdict: 'incident', raw_confidence: 0.9 }],
      },
      thresholds: [0, 0.7],
      policy: 'conservative_review_bias',
    });

    expect(result.policy).toBe('conservative_review_bias');
    expect(result.recommendedThreshold).toBe(0.7);
  });
});
