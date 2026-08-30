#!/usr/bin/env node
'use strict';

// Exportiert aus einem Dataset-Pack-Verzeichnis (policy-comparison.json +
// baseline-run.json) ein deploybares Routing-Policy-Artefakt:
//   recommended-routing-policy.json + .md
//
// Fail-closed: blockierter Run/Vergleich → blocked Artefakt + exit 1.

const fs = require('fs');
const path = require('path');
const { buildRoutingPolicy, renderRoutingPolicyMarkdown, DEFAULT_POLICY } = require('../src/domain/mlRoutingPolicy');

const KNOWN_POLICIES = new Set(['max_validation_agreement', 'conservative_review_bias']);

function printUsage() {
  process.stderr.write([
    'Usage: node scripts/mlEvalPolicyExport.js <dataset-pack-dir> [--policy <name>]',
    '',
    `Policies: max_validation_agreement | conservative_review_bias (default: ${DEFAULT_POLICY})`,
    '',
    'Example:',
    '  node scripts/mlEvalPolicyExport.js ../artifacts/ml-eval/247968fbba1c',
  ].join('\n') + '\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const datasetDir = args.shift();
  let policy = DEFAULT_POLICY;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--policy') {
      policy = String(args[i + 1] || '').trim() || DEFAULT_POLICY;
      i += 1;
    }
  }
  if (!datasetDir) return null;
  return { datasetDir, policy };
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts) {
    printUsage();
    return 2;
  }
  // Policy-Namen gegen Allowlist prüfen (Defense-in-Depth; buildRoutingPolicy
  // ist zwar fail-closed bei unbekannter Policy, aber so gibt es einen klaren Fehler).
  if (!KNOWN_POLICIES.has(opts.policy)) {
    process.stderr.write(`Unbekannte Policy: ${opts.policy} — erlaubt: ${[...KNOWN_POLICIES].join(', ')}\n`);
    return 2;
  }

  const dir = path.resolve(process.cwd(), opts.datasetDir);
  const runManifest = JSON.parse(fs.readFileSync(path.join(dir, 'baseline-run.json'), 'utf8'));
  const policyComparison = JSON.parse(fs.readFileSync(path.join(dir, 'policy-comparison.json'), 'utf8'));

  const routingPolicy = buildRoutingPolicy({ policyComparison, runManifest, policy: opts.policy });

  fs.writeFileSync(
    path.join(dir, 'recommended-routing-policy.json'),
    `${JSON.stringify(routingPolicy, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'recommended-routing-policy.md'),
    renderRoutingPolicyMarkdown(routingPolicy),
    'utf8',
  );

  process.stdout.write(`${JSON.stringify({
    status: routingPolicy.status,
    policyName: routingPolicy.policyName,
    recommendedThreshold: routingPolicy.recommendedThreshold,
    blockers: routingPolicy.blockers,
  }, null, 2)}\n`);

  return routingPolicy.status === 'ready' ? 0 : 1;
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
