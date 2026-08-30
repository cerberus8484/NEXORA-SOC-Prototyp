#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseJsonl, summarizeEvalRecords, renderMarkdownReport } = require('../src/domain/mlEvalReport');
const { buildSnapshotMeta, toJsonl } = require('../src/domain/mlEvalSnapshot');
const { buildDatasetManifest } = require('../src/domain/mlEvalDatasetManifest');
const { splitRecords, buildSplitManifest } = require('../src/domain/mlEvalSplit');
const { buildRunManifest } = require('../src/domain/mlEvalRunManifest');
const { buildBaselineEvaluation, renderBaselineMarkdown } = require('../src/domain/mlEvalBaseline');
const { buildReadinessReport, renderReadinessMarkdown } = require('../src/domain/mlEvalReadiness');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalGoldPipeline.js <gold.jsonl> [--out-dir ../artifacts/ml-eval] [--dataset-name name] [--split-name name] [--run-name name]',
    '',
    'Example:',
    '  node scripts/mlEvalGoldPipeline.js ../artifacts/ml-gold-merged.jsonl --out-dir ../artifacts/ml-eval',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const sourceFile = args.shift();
  const opts = {
    outDir: '../artifacts/ml-eval',
    datasetName: '',
    splitName: '',
    runName: '',
    seed: 'nexora-ml-eval-v1',
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out-dir') {
      opts.outDir = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--dataset-name') {
      opts.datasetName = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--split-name') {
      opts.splitName = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--run-name') {
      opts.runName = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--seed') {
      opts.seed = args[i + 1] || '';
      i += 1;
    }
  }
  if (!sourceFile || !opts.outDir) return null;
  return { sourceFile, ...opts };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts) {
    printUsage();
    return 2;
  }

  const sourcePath = path.resolve(process.cwd(), opts.sourceFile);
  const records = parseJsonl(fs.readFileSync(sourcePath, 'utf8'));
  const snapshotMeta = buildSnapshotMeta(records);
  const summary = summarizeEvalRecords(records);
  const datasetManifest = buildDatasetManifest({
    datasetName: opts.datasetName || `ml-eval-${snapshotMeta.recordSha256.slice(0, 12)}`,
    snapshotMeta,
    summary,
    sourceFile: opts.sourceFile,
  });

  const targetDir = path.resolve(process.cwd(), opts.outDir, snapshotMeta.recordSha256.slice(0, 12));
  ensureDir(targetDir);
  fs.writeFileSync(path.join(targetDir, 'snapshot.jsonl'), toJsonl(records), 'utf8');
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), `${JSON.stringify(datasetManifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'report.md'), renderMarkdownReport(summary), 'utf8');

  const splitPlan = splitRecords(records, { seed: opts.seed });
  const splitManifest = buildSplitManifest({
    datasetManifest,
    splitPlan,
    seed: opts.seed,
    splitName: opts.splitName || `${datasetManifest.datasetName}-split`,
  });
  fs.writeFileSync(path.join(targetDir, 'train.jsonl'), toJsonl(splitPlan.splits.train), 'utf8');
  fs.writeFileSync(path.join(targetDir, 'validation.jsonl'), toJsonl(splitPlan.splits.validation), 'utf8');
  fs.writeFileSync(path.join(targetDir, 'test.jsonl'), toJsonl(splitPlan.splits.test), 'utf8');
  fs.writeFileSync(path.join(targetDir, 'split-manifest.json'), `${JSON.stringify(splitManifest, null, 2)}\n`, 'utf8');

  const runManifest = buildRunManifest({
    runName: opts.runName || `${datasetManifest.datasetName}-run`,
    datasetManifest,
    splitManifest,
    objective: 'routing_threshold_baseline',
    strategy: 'rule_baseline',
  });
  fs.writeFileSync(path.join(targetDir, 'baseline-run.json'), `${JSON.stringify(runManifest, null, 2)}\n`, 'utf8');

  const baselineEval = buildBaselineEvaluation({
    runManifest,
    splitRecordsByName: splitPlan.splits,
  });
  fs.writeFileSync(path.join(targetDir, 'baseline-eval.json'), `${JSON.stringify(baselineEval, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'baseline-eval.md'), renderBaselineMarkdown(baselineEval), 'utf8');

  const readiness = buildReadinessReport({ datasetManifest, splitManifest, runManifest });
  fs.writeFileSync(path.join(targetDir, 'readiness-report.json'), `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'readiness-report.md'), renderReadinessMarkdown(readiness), 'utf8');

  process.stdout.write(`${JSON.stringify({
    targetDir,
    datasetName: datasetManifest.datasetName,
    records: records.length,
    routingGate: datasetManifest.quality.routingGate.status,
    splitQuality: splitManifest.splitQuality.status,
    runStatus: runManifest.status,
    nextActions: readiness.nextActions,
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
