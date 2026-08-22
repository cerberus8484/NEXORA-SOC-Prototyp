#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseJsonl } = require('../src/domain/mlEvalReport');
const { buildThresholdComparison, renderThresholdComparisonMarkdown, DEFAULT_THRESHOLDS } = require('../src/domain/mlEvalThresholdComparison');

const POLICIES = ['max_validation_agreement', 'conservative_review_bias'];

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalRunPolicyCompare.js <dataset-pack-dir> [--thresholds 0,0.5,0.7,0.9]',
    '',
    'Example:',
    '  node scripts/mlEvalRunPolicyCompare.js ../artifacts/ml-eval/247968fbba1c',
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
  const splitRecordsByName = {
    train: readSplit(path.join(dir, 'train.jsonl')),
    validation: readSplit(path.join(dir, 'validation.jsonl')),
    test: readSplit(path.join(dir, 'test.jsonl')),
  };

  const comparisons = POLICIES.map((policy) => buildThresholdComparison({
    runManifest,
    splitRecordsByName,
    thresholds: opts.thresholds,
    policy,
  }));

  const summary = {
    runName: runManifest.runName,
    generatedAt: new Date().toISOString(),
    status: comparisons.every((item) => item.status === 'ok') ? 'ok' : 'blocked',
    policies: comparisons.map((item) => ({
      policy: item.policy,
      recommendedThreshold: item.recommendedThreshold,
      blockers: item.blockers,
    })),
  };

  fs.writeFileSync(path.join(dir, 'policy-comparison.json'), `${JSON.stringify({ summary, comparisons }, null, 2)}\n`, 'utf8');
  const markdown = [
    '# Nexora ML Policy Comparison',
    '',
    `Run: ${summary.runName}`,
    `Status: ${summary.status}`,
    '',
    '## Policies',
    '',
    ...summary.policies.map((policy) => `- ${policy.policy}: >=${policy.recommendedThreshold ?? 'n/a'}`),
    '',
    ...comparisons.map((item) => renderThresholdComparisonMarkdown(item)),
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'policy-comparison.md'), `${markdown}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary.status === 'ok' ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, main, POLICIES };
