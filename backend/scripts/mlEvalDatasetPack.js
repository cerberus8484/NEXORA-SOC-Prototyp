#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseJsonl, summarizeEvalRecords, renderMarkdownReport } = require('../src/domain/mlEvalReport');
const { buildSnapshotMeta, toJsonl } = require('../src/domain/mlEvalSnapshot');
const { buildDatasetManifest } = require('../src/domain/mlEvalDatasetManifest');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalDatasetPack.js <snapshot.jsonl> [--out-dir ../artifacts/ml-eval] [--dataset-name name]',
    '',
    'Example:',
    '  node scripts/mlEvalDatasetPack.js ../docs/01-architecture/ml-gold-sample.jsonl --out-dir ../artifacts/ml-eval',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const file = args.shift();
  let outDir = '../artifacts/ml-eval';
  let datasetName = '';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out-dir') {
      outDir = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--dataset-name') {
      datasetName = args[i + 1] || '';
      i += 1;
    }
  }
  if (!file || !outDir) return null;
  return { file, outDir, datasetName };
}

function buildPack(records, { file, datasetName } = {}) {
  const snapshotMeta = buildSnapshotMeta(records);
  const summary = summarizeEvalRecords(records);
  const manifest = buildDatasetManifest({
    datasetName: datasetName || `ml-eval-${snapshotMeta.recordSha256.slice(0, 12)}`,
    snapshotMeta,
    summary,
    sourceFile: file,
  });

  return {
    snapshotMeta,
    summary,
    manifest,
    files: {
      snapshotJsonl: toJsonl(records),
      manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
      reportJson: `${JSON.stringify(summary, null, 2)}\n`,
      reportMarkdown: renderMarkdownReport(summary),
    },
  };
}

function writePack(pack, outDir) {
  const targetDir = path.resolve(process.cwd(), outDir, pack.manifest.snapshot.recordSha256.slice(0, 12));
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'snapshot.jsonl'), pack.files.snapshotJsonl, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), pack.files.manifestJson, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'report.json'), pack.files.reportJson, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'report.md'), pack.files.reportMarkdown, 'utf8');
  return targetDir;
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts) {
    printUsage();
    return 2;
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  const records = parseJsonl(fs.readFileSync(filePath, 'utf8'));
  const pack = buildPack(records, { file: opts.file, datasetName: opts.datasetName });
  const targetDir = writePack(pack, opts.outDir);
  process.stdout.write(`${JSON.stringify({
    datasetName: pack.manifest.datasetName,
    targetDir,
    recordSha256: pack.manifest.snapshot.recordSha256,
    routingGate: pack.manifest.quality.routingGate.status,
    warnings: pack.manifest.quality.warnings,
  }, null, 2)}\n`);
  return pack.summary.warnings.length || pack.summary.routingGate.status !== 'pass' ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs, buildPack, writePack };
