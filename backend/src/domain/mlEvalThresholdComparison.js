'use strict';

const { evaluateThreshold } = require('./mlEvalBaseline');

const DEFAULT_THRESHOLDS = [0, 0.5, 0.7, 0.9];
const DEFAULT_POLICY = 'max_validation_agreement';

function evaluateThresholdSet(splitRecordsByName, thresholds = DEFAULT_THRESHOLDS) {
  return thresholds.map((threshold) => ({
    threshold,
    train: evaluateThreshold(splitRecordsByName.train || [], threshold),
    validation: evaluateThreshold(splitRecordsByName.validation || [], threshold),
    test: evaluateThreshold(splitRecordsByName.test || [], threshold),
  }));
}

function rankThresholds(rows) {
  return [...rows].sort((a, b) => {
    const aAgreement = a.validation.agreement ?? -1;
    const bAgreement = b.validation.agreement ?? -1;
    if (bAgreement !== aAgreement) return bAgreement - aAgreement;
    const aCoverage = a.validation.coverage ?? -1;
    const bCoverage = b.validation.coverage ?? -1;
    if (bCoverage !== aCoverage) return bCoverage - aCoverage;
    return a.threshold - b.threshold;
  });
}

function rankThresholdsConservative(rows) {
  return [...rows].sort((a, b) => {
    const aAgreement = a.validation.agreement ?? -1;
    const bAgreement = b.validation.agreement ?? -1;
    if (bAgreement !== aAgreement) return bAgreement - aAgreement;

    const aCoverage = a.validation.coverage ?? -1;
    const bCoverage = b.validation.coverage ?? -1;
    const coverageTie = Math.abs(aCoverage - bCoverage) <= 0.25;
    if (!coverageTie && bCoverage !== aCoverage) return bCoverage - aCoverage;

    if (a.threshold !== b.threshold) return b.threshold - a.threshold;
    return 0;
  });
}

function rankByPolicy(rows, policy = DEFAULT_POLICY) {
  if (policy === 'conservative_review_bias') return rankThresholdsConservative(rows);
  return rankThresholds(rows);
}

function buildThresholdComparison({ runManifest, splitRecordsByName, thresholds = DEFAULT_THRESHOLDS, policy = DEFAULT_POLICY } = {}) {
  if (!runManifest) throw new Error('runManifest is required');
  if (!splitRecordsByName) throw new Error('splitRecordsByName is required');

  if (runManifest.status !== 'ready') {
    return {
      runName: runManifest.runName,
      generatedAt: new Date().toISOString(),
      status: 'blocked',
      blockers: runManifest.blockers || ['run_not_ready'],
      policy,
      thresholds: [],
      recommendedThreshold: null,
    };
  }

  const rows = evaluateThresholdSet(splitRecordsByName, thresholds);
  const ranked = rankByPolicy(rows, policy);
  return {
    runName: runManifest.runName,
    generatedAt: new Date().toISOString(),
    status: 'ok',
    blockers: [],
    policy,
    thresholds: rows,
    recommendedThreshold: ranked[0]?.threshold ?? null,
    selectedByValidation: ranked[0] || null,
  };
}

function renderThresholdComparisonMarkdown(result) {
  const lines = [
    '# Nexora ML Threshold Comparison',
    '',
    `Run: ${result.runName}`,
    `Status: ${result.status}`,
  ];
  lines.push(`Policy: ${result.policy || DEFAULT_POLICY}`);
  if (result.recommendedThreshold !== null) {
    lines.push(`Recommended threshold: >=${result.recommendedThreshold}`);
  }
  if (result.blockers?.length) {
    lines.push('', '## Blockers', '');
    for (const blocker of result.blockers) lines.push(`- ${blocker}`);
  }
  if (result.status === 'ok') {
    lines.push('', '## Thresholds', '');
    for (const row of result.thresholds) {
      lines.push(`### >=${row.threshold}`, '');
      lines.push(`- validation agreement=${row.validation.agreement ?? 'n/a'}, coverage=${row.validation.coverage ?? 'n/a'}`);
      lines.push(`- test agreement=${row.test.agreement ?? 'n/a'}, coverage=${row.test.coverage ?? 'n/a'}`);
      lines.push(`- train agreement=${row.train.agreement ?? 'n/a'}, coverage=${row.train.coverage ?? 'n/a'}`, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  DEFAULT_THRESHOLDS,
  DEFAULT_POLICY,
  evaluateThresholdSet,
  rankThresholds,
  rankThresholdsConservative,
  rankByPolicy,
  buildThresholdComparison,
  renderThresholdComparisonMarkdown,
};
