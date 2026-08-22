'use strict';

const { splitRecords, buildSplitManifest, normalizeRatios } = require('../../src/domain/mlEvalSplit');

describe('mlEvalSplit', () => {
  test('normalisiert Ratios robust', () => {
    expect(normalizeRatios({ train: 7, validation: 2, test: 1 })).toEqual({
      train: 0.7,
      validation: 0.2,
      test: 0.1,
    });
  });

  test('splittet deterministisch nach human_label-Buckets', () => {
    const records = [
      { entity_id: 'a', ticket_id: 'a', human_label: 'incident' },
      { entity_id: 'b', ticket_id: 'b', human_label: 'incident' },
      { entity_id: 'c', ticket_id: 'c', human_label: 'false_positive' },
      { entity_id: 'd', ticket_id: 'd', human_label: 'false_positive' },
      { entity_id: 'e', ticket_id: 'e', human_label: 'benign' },
      { entity_id: 'f', ticket_id: 'f', human_label: 'benign' },
    ];

    const splitA = splitRecords(records, { seed: 'seed-1', ratios: { train: 0.5, validation: 0.25, test: 0.25 } });
    const splitB = splitRecords(records, { seed: 'seed-1', ratios: { train: 0.5, validation: 0.25, test: 0.25 } });

    expect(splitA).toEqual(splitB);
    expect(splitA.counts.total).toBe(6);
    expect(splitA.counts.train + splitA.counts.validation + splitA.counts.test).toBe(6);
  });

  test('baut Split-Manifest mit referenzierbaren Hashes', () => {
    const splitPlan = {
      ratios: { train: 0.7, validation: 0.15, test: 0.15 },
      counts: { train: 2, validation: 1, test: 1, total: 4 },
      splits: {
        train: [{ entity_id: 'a', ticket_id: 'a', human_label: 'incident' }, { entity_id: 'b', ticket_id: 'b', human_label: 'incident' }],
        validation: [{ entity_id: 'c', ticket_id: 'c', human_label: 'benign' }],
        test: [{ entity_id: 'd', ticket_id: 'd', human_label: 'false_positive' }],
      },
    };

    const manifest = buildSplitManifest({
      datasetManifest: {
        datasetName: 'baseline',
        snapshot: { recordSha256: 'f'.repeat(64) },
      },
      splitPlan,
      seed: 'seed-1',
      splitName: 'baseline-split',
    });

    expect(manifest.datasetSha256).toBe('f'.repeat(64));
    expect(manifest.splitSha256.train).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.splitQuality).toEqual({ status: 'ok', warnings: [] });
    expect(manifest.byLabel.train).toEqual({ incident: 2 });
    expect(manifest.byLabel.validation).toEqual({ benign: 1 });
    expect(manifest.byLabel.test).toEqual({ false_positive: 1 });
  });

  test('markiert unbrauchbare leere validation/test splits explizit', () => {
    const manifest = buildSplitManifest({
      datasetManifest: {
        datasetName: 'tiny',
        snapshot: { recordSha256: 'f'.repeat(64) },
      },
      splitPlan: {
        ratios: { train: 0.7, validation: 0.15, test: 0.15 },
        counts: { train: 4, validation: 0, test: 0, total: 4 },
        splits: { train: [{ entity_id: 'a', ticket_id: 'a', human_label: 'incident' }], validation: [], test: [] },
      },
    });

    expect(manifest.splitQuality).toEqual({
      status: 'warn',
      warnings: ['validation_split_empty', 'test_split_empty'],
    });
  });
});
