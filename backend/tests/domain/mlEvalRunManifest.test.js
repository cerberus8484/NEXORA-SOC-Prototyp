'use strict';

const { buildRunManifest } = require('../../src/domain/mlEvalRunManifest');

describe('mlEvalRunManifest', () => {
  test('markiert einen Run als blocked wenn Gate oder Splits nicht tragfaehig sind', () => {
    const manifest = buildRunManifest({
      runName: 'baseline-v1',
      datasetManifest: {
        datasetName: 'dataset-a',
        generatedAt: '2026-06-29T15:00:00.000Z',
        snapshot: { recordSha256: 'a'.repeat(64) },
        quality: {
          routingGate: {
            status: 'fail',
            gate: { minAgreement: 0.8, minCoverage: 0.5, minGoldRecords: 20 },
            failures: ['gold_records 4 < 20'],
          },
        },
      },
      splitManifest: {
        splitName: 'split-a',
        seed: 'seed-1',
        ratios: { train: 0.7, validation: 0.15, test: 0.15 },
        counts: { train: 4, validation: 0, test: 0, total: 4 },
        splitQuality: { status: 'warn', warnings: ['validation_split_empty', 'test_split_empty'] },
        splitSha256: { train: 'b'.repeat(64), validation: 'c'.repeat(64), test: 'd'.repeat(64) },
      },
    });

    expect(manifest.status).toBe('blocked');
    expect(manifest.blockers).toEqual([
      'routing_gate_fail',
      'split_validation_split_empty',
      'split_test_split_empty',
    ]);
  });

  test('markiert einen tragfaehigen Run als ready', () => {
    const manifest = buildRunManifest({
      datasetManifest: {
        datasetName: 'dataset-a',
        generatedAt: '2026-06-29T15:00:00.000Z',
        snapshot: { recordSha256: 'a'.repeat(64) },
        quality: {
          routingGate: {
            status: 'pass',
            gate: { minAgreement: 0.8, minCoverage: 0.5, minGoldRecords: 20 },
            failures: [],
          },
        },
      },
      splitManifest: {
        splitName: 'split-a',
        seed: 'seed-1',
        ratios: { train: 0.7, validation: 0.15, test: 0.15 },
        counts: { train: 7, validation: 2, test: 1, total: 10 },
        splitQuality: { status: 'ok', warnings: [] },
        splitSha256: { train: 'b'.repeat(64), validation: 'c'.repeat(64), test: 'd'.repeat(64) },
      },
    });

    expect(manifest.status).toBe('ready');
    expect(manifest.blockers).toEqual([]);
  });
});
