#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildReadinessReport, renderReadinessMarkdown } = require('../src/domain/mlEvalReadiness');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalReadiness.js <dataset-pack-dir>',
    '',
    'Example:',
    '  node scripts/mlEvalReadiness.js ../artifacts/ml-eval/f1d0648fe6f6',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const datasetDir = argv[0];
  if (!datasetDir) return null;
  return { datasetDir };
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
  const runManifest = JSON.parse(fs.readFileSync(path.join(dir, 'baseline-run.json'), 'utf8'));
  const report = buildReadinessReport({ datasetManifest, splitManifest, runManifest });

  fs.writeFileSync(path.join(dir, 'readiness-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'readiness-report.md'), renderReadinessMarkdown(report), 'utf8');
  process.stdout.write(`${JSON.stringify({
    datasetName: report.datasetName,
    runName: report.runName,
    status: report.status,
    nextActions: report.nextActions,
  }, null, 2)}\n`);
  return report.status === 'ready' ? 0 : 1;
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
