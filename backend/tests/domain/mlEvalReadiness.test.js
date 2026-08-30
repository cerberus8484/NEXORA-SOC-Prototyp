'use strict';

const { buildReadinessReport } = require('../../src/domain/mlEvalReadiness');

describe('mlEvalReadiness', () => {
  test('macht fehlende Gold-Records und Split-Luecken explizit', () => {
    const report = buildReadinessReport({
      datasetManifest: {
        datasetName: 'dataset-a',
        quality: {
          goldRecords: 4,
          routingGate: {
            status: 'fail',
            gate: { minGoldRecords: 20 },
            failures: ['gold_records 4 < 20'],
          },
        },
      },
      splitManifest: {
        counts: { train: 4, validation: 0, test: 0, total: 4 },
        splitQuality: { warnings: ['validation_split_empty', 'test_split_empty'] },
      },
      runManifest: {
        runName: 'run-a',
        status: 'blocked',
        blockers: ['routing_gate_fail', 'split_validation_split_empty', 'split_test_split_empty'],
      },
    });

    expect(report.status).toBe('blocked');
    expect(report.gateGap.missingGoldRecords).toBe(16);
    expect(report.splitGap.missingValidationRecords).toBe(1);
    expect(report.splitGap.missingTestRecords).toBe(1);
    expect(report.nextActions).toContain('add_at_least_16_more_gold_records');
  });
});
