#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildRunManifest } = require('../src/domain/mlEvalRunManifest');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalRunInit.js <dataset-pack-dir> [--run-name name] [--objective objective] [--strategy strategy] [--notes text]',
    '',
    'Example:',
    '  node scripts/mlEvalRunInit.js ../artifacts/ml-eval/f1d0648fe6f6 --run-name baseline-v1',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const datasetDir = args.shift();
  const opts = {
    runName: '',
    objective: 'offline_eval_baseline',
    strategy: 'rule_baseline',
    notes: '',
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--run-name') {
      opts.runName = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--objective') {
      opts.objective = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--strategy') {
      opts.strategy = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--notes') {
      opts.notes = args[i + 1] || '';
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
  const datasetManifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const splitManifest = JSON.parse(fs.readFileSync(path.join(dir, 'split-manifest.json'), 'utf8'));
  const runManifest = buildRunManifest({
    runName: opts.runName || `${datasetManifest.datasetName}-run`,
    datasetManifest,
    splitManifest,
    objective: opts.objective,
    strategy: opts.strategy,
    notes: opts.notes,
  });

  fs.writeFileSync(path.join(dir, 'baseline-run.json'), `${JSON.stringify(runManifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    runName: runManifest.runName,
    status: runManifest.status,
    blockers: runManifest.blockers,
    datasetSha256: runManifest.dataset.datasetSha256,
    splitName: runManifest.split.splitName,
  }, null, 2)}\n`);
  return runManifest.status === 'ready' ? 0 : 1;
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
