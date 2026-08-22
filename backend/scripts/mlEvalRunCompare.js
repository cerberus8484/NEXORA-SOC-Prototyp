#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseJsonl } = require('../src/domain/mlEvalReport');
const { buildThresholdComparison, renderThresholdComparisonMarkdown, DEFAULT_THRESHOLDS } = require('../src/domain/mlEvalThresholdComparison');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalRunCompare.js <dataset-pack-dir> [--thresholds 0,0.5,0.7,0.9]',
    '',
    'Example:',
    '  node scripts/mlEvalRunCompare.js ../artifacts/ml-eval/247968fbba1c',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const datasetDir = args.shift();
  let thresholds = DEFAULT_THRESHOLDS;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--thresholds') {
      thresholds = String(args[i + 1] || '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value));
      i += 1;
    }
  }
  if (!datasetDir) return null;
  return { datasetDir, thresholds: thresholds.length ? thresholds : DEFAULT_THRESHOLDS };
}

function readSplit(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return parseJsonl(fs.readFileSync(filePath, 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts) {
    printUsage();
    return 2;
  }

  const dir = path.resolve(process.cwd(), opts.datasetDir);
  const runManifest = JSON.parse(fs.readFileSync(path.join(dir, 'baseline-run.json'), 'utf8'));
  const result = buildThresholdComparison({
    runManifest,
    splitRecordsByName: {
      train: readSplit(path.join(dir, 'train.jsonl')),
      validation: readSplit(path.join(dir, 'validation.jsonl')),
      test: readSplit(path.join(dir, 'test.jsonl')),
    },
    thresholds: opts.thresholds,
  });

  fs.writeFileSync(path.join(dir, 'threshold-comparison.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'threshold-comparison.md'), renderThresholdComparisonMarkdown(result), 'utf8');
  process.stdout.write(`${JSON.stringify({
    runName: result.runName,
    status: result.status,
    recommendedThreshold: result.recommendedThreshold,
    blockers: result.blockers,
  }, null, 2)}\n`);
  return result.status === 'ok' ? 0 : 1;
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
