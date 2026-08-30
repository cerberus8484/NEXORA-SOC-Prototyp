#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildGoldMergeResult } = require('../src/domain/mlGoldDataset');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlGoldMerge.js <base.jsonl> <incoming.jsonl> [--out output.jsonl]',
    '',
    'Example:',
    '  node scripts/mlGoldMerge.js ../docs/01-architecture/ml-gold-sample.jsonl ./new-gold.jsonl --out ../artifacts/ml-gold-merged.jsonl',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const baseFile = args.shift();
  const incomingFile = args.shift();
  let outFile = '';
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') {
      outFile = args[i + 1] || '';
      i += 1;
    }
  }
  if (!baseFile || !incomingFile) return null;
  return { baseFile, incomingFile, outFile };
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts) {
    printUsage();
    return 2;
  }

  const result = buildGoldMergeResult({
    baseText: fs.readFileSync(path.resolve(process.cwd(), opts.baseFile), 'utf8'),
    incomingText: fs.readFileSync(path.resolve(process.cwd(), opts.incomingFile), 'utf8'),
  });

  if (opts.outFile) {
    fs.writeFileSync(path.resolve(process.cwd(), opts.outFile), result.output, 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    baseRecords: result.baseRecords.length,
    incomingRecords: result.incomingRecords.length,
    mergedRecords: result.mergedRecords.length,
    baseWarnings: result.warnings.base.length,
    incomingWarnings: result.warnings.incoming.length,
    mergedWarnings: result.warnings.merged.length,
  }, null, 2)}\n`);

  return result.warnings.base.length || result.warnings.incoming.length || result.warnings.merged.length ? 1 : 0;
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
