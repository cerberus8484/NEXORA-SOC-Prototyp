#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseJsonl } = require('../src/domain/mlEvalReport');
const { buildBaselineEvaluation, renderBaselineMarkdown } = require('../src/domain/mlEvalBaseline');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalRunEvaluate.js <dataset-pack-dir>',
    '',
    'Example:',
    '  node scripts/mlEvalRunEvaluate.js ../artifacts/ml-eval/f1d0648fe6f6',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const datasetDir = argv[0];
  if (!datasetDir) return null;
  return { datasetDir };
}

function readSplitFile(filePath) {
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
  const result = buildBaselineEvaluation({
    runManifest,
    splitRecordsByName: {
      train: readSplitFile(path.join(dir, 'train.jsonl')),
      validation: readSplitFile(path.join(dir, 'validation.jsonl')),
      test: readSplitFile(path.join(dir, 'test.jsonl')),
    },
  });

  fs.writeFileSync(path.join(dir, 'baseline-eval.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'baseline-eval.md'), renderBaselineMarkdown(result), 'utf8');
  process.stdout.write(`${JSON.stringify({
    runName: result.runName,
    status: result.status,
    blockers: result.blockers,
    selectedThreshold: result.selectedThreshold,
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
