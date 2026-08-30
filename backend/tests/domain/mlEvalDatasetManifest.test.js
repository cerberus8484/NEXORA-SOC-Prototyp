'use strict';

const { buildDatasetManifest } = require('../../src/domain/mlEvalDatasetManifest');

describe('mlEvalDatasetManifest', () => {
  test('baut ein kompaktes, referenzierbares Manifest', () => {
    const manifest = buildDatasetManifest({
      datasetName: 'gold-baseline',
      sourceFile: '../docs/sample.jsonl',
      snapshotMeta: {
        generatedAt: '2026-06-29T12:00:00.000Z',
        schemaVersion: 'v1',
        recordCount: 4,
        recordSha256: 'a'.repeat(64),
        labelSourceCounts: { gold_review: 4 },
        humanLabelCounts: { incident: 2, false_positive: 1, benign: 1 },
      },
      summary: {
        warnings: [],
        outcomeAgreement: { comparable: 4, correct: 3, agreement: 0.75 },
        gold: { total: 4 },
        routingGate: {
          status: 'fail',
          gate: { minAgreement: 0.8, minCoverage: 0.5, minGoldRecords: 20 },
          selected: null,
          failures: ['gold_records 4 < 20'],
        },
      },
    });

    expect(manifest).toEqual({
      datasetName: 'gold-baseline',
      generatedAt: '2026-06-29T12:00:00.000Z',
      schemaVersion: 'v1',
      sourceFile: '../docs/sample.jsonl',
      snapshot: {
        recordCount: 4,
        recordSha256: 'a'.repeat(64),
        labelSourceCounts: { gold_review: 4 },
        humanLabelCounts: { incident: 2, false_positive: 1, benign: 1 },
      },
      quality: {
        warnings: 0,
        routingGate: {
          status: 'fail',
          gate: { minAgreement: 0.8, minCoverage: 0.5, minGoldRecords: 20 },
          selectedThreshold: null,
          failures: ['gold_records 4 < 20'],
        },
        outcomeAgreement: { comparable: 4, correct: 3, agreement: 0.75 },
        goldRecords: 4,
      },
    });
  });
});
