#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseJsonl, summarizeEvalRecords } = require('../src/domain/mlEvalReport');
const { toJsonl } = require('../src/domain/mlEvalSnapshot');
const { splitRecords, buildSplitManifest } = require('../src/domain/mlEvalSplit');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalDatasetSplit.js <dataset-pack-dir> [--seed seed] [--train 0.7] [--validation 0.15] [--test 0.15] [--split-name name]',
    '',
    'Example:',
    '  node scripts/mlEvalDatasetSplit.js ../artifacts/ml-eval/f1d0648fe6f6 --split-name baseline-v1',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const datasetDir = args.shift();
  const opts = {
    seed: 'nexora-ml-eval-v1',
    train: 0.7,
    validation: 0.15,
    test: 0.15,
    splitName: '',
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--seed') {
      opts.seed = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--train') {
      opts.train = Number(args[i + 1]);
      i += 1;
    } else if (args[i] === '--validation') {
      opts.validation = Number(args[i + 1]);
      i += 1;
    } else if (args[i] === '--test') {
      opts.test = Number(args[i + 1]);
      i += 1;
    } else if (args[i] === '--split-name') {
      opts.splitName = args[i + 1] || '';
      i += 1;
    }
  }
  if (!datasetDir) return null;
  return { datasetDir, ...opts };
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts) {
    printUsage();
    return 2;
  }

  const dir = path.resolve(process.cwd(), opts.datasetDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const records = parseJsonl(fs.readFileSync(path.join(dir, 'snapshot.jsonl'), 'utf8'));
  const splitPlan = splitRecords(records, {
    seed: opts.seed,
    ratios: { train: opts.train, validation: opts.validation, test: opts.test },
  });
  const splitManifest = buildSplitManifest({
    datasetManifest: manifest,
    splitPlan,
    seed: opts.seed,
    splitName: opts.splitName || `${manifest.datasetName}-split`,
  });

  fs.writeFileSync(path.join(dir, 'train.jsonl'), toJsonl(splitPlan.splits.train), 'utf8');
  fs.writeFileSync(path.join(dir, 'validation.jsonl'), toJsonl(splitPlan.splits.validation), 'utf8');
  fs.writeFileSync(path.join(dir, 'test.jsonl'), toJsonl(splitPlan.splits.test), 'utf8');
  fs.writeFileSync(path.join(dir, 'split-manifest.json'), `${JSON.stringify(splitManifest, null, 2)}\n`, 'utf8');

  const quality = summarizeEvalRecords(records);
  process.stdout.write(`${JSON.stringify({
    datasetName: manifest.datasetName,
    splitName: splitManifest.splitName,
    counts: splitManifest.counts,
    splitQuality: splitManifest.splitQuality,
    routingGate: quality.routingGate.status,
  }, null, 2)}\n`);
  return quality.warnings.length || quality.routingGate.status !== 'pass' || splitManifest.splitQuality.status !== 'ok' ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, main };
