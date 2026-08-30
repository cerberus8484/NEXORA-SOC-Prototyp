'use strict';

const crypto = require('crypto');
const { buildSnapshotDigest } = require('./mlEvalSnapshot');

function stableSortKey(record, seed) {
  return crypto
    .createHash('sha256')
    .update(`${seed}:${record.entity_id}:${record.ticket_id}:${record.human_label}`, 'utf8')
    .digest('hex');
}

function allocateCounts(total, ratios) {
  if (total <= 0) return { train: 0, validation: 0, test: 0 };
  const base = {
    train: Math.floor(total * ratios.train),
    validation: Math.floor(total * ratios.validation),
    test: Math.floor(total * ratios.test),
  };
  let remaining = total - base.train - base.validation - base.test;
  const order = ['train', 'validation', 'test'];
  let i = 0;
  while (remaining > 0) {
    base[order[i % order.length]] += 1;
    remaining -= 1;
    i += 1;
  }
  return base;
}

function normalizeRatios(ratios = {}) {
  const train = Number(ratios.train ?? 0.7);
  const validation = Number(ratios.validation ?? 0.15);
  const test = Number(ratios.test ?? 0.15);
  const sum = train + validation + test;
  if (!Number.isFinite(train) || !Number.isFinite(validation) || !Number.isFinite(test) || sum <= 0) {
    throw new Error('Invalid split ratios');
  }
  return {
    train: train / sum,
    validation: validation / sum,
    test: test / sum,
  };
}

function splitRecords(records, { seed = 'nexora-ml-eval-v1', ratios } = {}) {
  const normalizedRatios = normalizeRatios(ratios);
  const buckets = new Map();
  for (const record of records) {
    const key = String(record.human_label || '_empty');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }

  const splits = { train: [], validation: [], test: [] };
  for (const bucketRecords of buckets.values()) {
    const ordered = [...bucketRecords].sort((a, b) => stableSortKey(a, seed).localeCompare(stableSortKey(b, seed)));
    const counts = allocateCounts(ordered.length, normalizedRatios);
    splits.train.push(...ordered.slice(0, counts.train));
    splits.validation.push(...ordered.slice(counts.train, counts.train + counts.validation));
    splits.test.push(...ordered.slice(counts.train + counts.validation));
  }

  for (const key of Object.keys(splits)) {
    splits[key] = splits[key].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  }

  return {
    ratios: normalizedRatios,
    splits,
    counts: {
      train: splits.train.length,
      validation: splits.validation.length,
      test: splits.test.length,
      total: records.length,
    },
  };
}

function buildSplitManifest({
  datasetManifest,
  splitPlan,
  seed = 'nexora-ml-eval-v1',
  splitName = 'baseline-split',
} = {}) {
  if (!datasetManifest) throw new Error('datasetManifest is required');
  if (!splitPlan) throw new Error('splitPlan is required');

  const warnings = [];
  if (splitPlan.counts.validation === 0) warnings.push('validation_split_empty');
  if (splitPlan.counts.test === 0) warnings.push('test_split_empty');
  if (splitPlan.counts.train === 0) warnings.push('train_split_empty');

  return {
    splitName: String(splitName || 'baseline-split'),
    generatedAt: new Date().toISOString(),
    datasetName: datasetManifest.datasetName,
    datasetSha256: datasetManifest.snapshot.recordSha256,
    seed,
    ratios: splitPlan.ratios,
    counts: splitPlan.counts,
    splitQuality: {
      status: warnings.length ? 'warn' : 'ok',
      warnings,
    },
    splitSha256: {
      train: buildSnapshotDigest(splitPlan.splits.train),
      validation: buildSnapshotDigest(splitPlan.splits.validation),
      test: buildSnapshotDigest(splitPlan.splits.test),
    },
    byLabel: ['train', 'validation', 'test'].reduce((acc, split) => {
      acc[split] = splitPlan.splits[split].reduce((map, record) => {
        const key = String(record.human_label || '_empty');
        map[key] = (map[key] || 0) + 1;
        return map;
      }, {});
      return acc;
    }, {}),
  };
}

module.exports = {
  normalizeRatios,
  splitRecords,
  buildSplitManifest,
};
