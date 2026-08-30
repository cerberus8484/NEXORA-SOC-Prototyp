#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  parseJsonl,
  summarizeEvalRecords,
  renderMarkdownReport,
} = require('../src/domain/mlEvalReport');

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalReport.js <snapshot.jsonl> [--format markdown|json]',
    '       [--min-agreement 0.8] [--min-coverage 0.5] [--min-gold-records 20]',
    '',
    'Example:',
    '  node scripts/mlEvalReport.js ../docs/01-architecture/ml-eval-sample.jsonl',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const file = args.shift();
  let format = 'markdown';
  const gate = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--format') {
      format = args[i + 1] || '';
      i += 1;
    } else if (args[i] === '--min-agreement') {
      gate.minAgreement = Number(args[i + 1]);
      i += 1;
    } else if (args[i] === '--min-coverage') {
      gate.minCoverage = Number(args[i + 1]);
      i += 1;
    } else if (args[i] === '--min-gold-records') {
      gate.minGoldRecords = Number(args[i + 1]);
      i += 1;
    }
  }
  if (!file || !['markdown', 'json'].includes(format)) return null;
  return { file, format, gate };
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts) {
    printUsage();
    return 2;
  }

  const filePath = path.resolve(process.cwd(), opts.file);
  const records = parseJsonl(fs.readFileSync(filePath, 'utf8'));
  const summary = summarizeEvalRecords(records, { gate: opts.gate });
  const output = opts.format === 'json'
    ? `${JSON.stringify(summary, null, 2)}\n`
    : renderMarkdownReport(summary);
  process.stdout.write(output);
  return summary.warnings.length || summary.routingGate.status !== 'pass' ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
