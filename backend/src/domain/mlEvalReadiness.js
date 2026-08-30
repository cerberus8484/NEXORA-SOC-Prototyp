'use strict';

function buildGateGap(routingGate) {
  const minGoldRecords = routingGate?.gate?.minGoldRecords ?? 0;
  const goldRecords = routingGate?.goldRecords ?? 0;
  return {
    goldRecords,
    minGoldRecords,
    missingGoldRecords: Math.max(0, minGoldRecords - goldRecords),
    routingStatus: routingGate?.status || 'fail',
    failures: routingGate?.failures || [],
  };
}

function buildSplitGap(splitManifest) {
  const counts = splitManifest?.counts || { train: 0, validation: 0, test: 0, total: 0 };
  const warnings = splitManifest?.splitQuality?.warnings || [];
  return {
    counts,
    warnings,
    missingValidationRecords: counts.validation > 0 ? 0 : 1,
    missingTestRecords: counts.test > 0 ? 0 : 1,
  };
}

function buildReadinessReport({ datasetManifest, splitManifest, runManifest } = {}) {
  if (!datasetManifest) throw new Error('datasetManifest is required');
  if (!splitManifest) throw new Error('splitManifest is required');
  if (!runManifest) throw new Error('runManifest is required');

  const gateGap = buildGateGap({
    ...datasetManifest.quality.routingGate,
    goldRecords: datasetManifest.quality.goldRecords,
  });
  const splitGap = buildSplitGap(splitManifest);
  const blockers = runManifest.blockers || [];

  return {
    datasetName: datasetManifest.datasetName,
    runName: runManifest.runName,
    generatedAt: new Date().toISOString(),
    status: runManifest.status === 'ready' ? 'ready' : 'blocked',
    blockers,
    gateGap,
    splitGap,
    nextActions: [
      ...(gateGap.missingGoldRecords > 0
        ? [`add_at_least_${gateGap.missingGoldRecords}_more_gold_records`]
        : []),
      ...(splitGap.missingValidationRecords ? ['add_enough_records_for_non_empty_validation_split'] : []),
      ...(splitGap.missingTestRecords ? ['add_enough_records_for_non_empty_test_split'] : []),
    ],
  };
}

function renderReadinessMarkdown(report) {
  const lines = [
    '# Nexora ML Readiness Report',
    '',
    `Dataset: ${report.datasetName}`,
    `Run: ${report.runName}`,
    `Status: ${report.status}`,
    '',
    '## Blockers',
    '',
  ];
  if (report.blockers.length) {
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push('- none');
  }
  lines.push('', '## Gate Gap', '');
  lines.push(`- gold_records=${report.gateGap.goldRecords}/${report.gateGap.minGoldRecords}`);
  lines.push(`- missing_gold_records=${report.gateGap.missingGoldRecords}`);
  lines.push(`- routing_status=${report.gateGap.routingStatus}`);
  if (report.gateGap.failures.length) {
    for (const failure of report.gateGap.failures) lines.push(`- ${failure}`);
  }
  lines.push('', '## Split Gap', '');
  lines.push(`- train=${report.splitGap.counts.train}`);
  lines.push(`- validation=${report.splitGap.counts.validation}`);
  lines.push(`- test=${report.splitGap.counts.test}`);
  if (report.splitGap.warnings.length) {
    for (const warning of report.splitGap.warnings) lines.push(`- ${warning}`);
  }
  lines.push('', '## Next Actions', '');
  if (report.nextActions.length) {
    for (const action of report.nextActions) lines.push(`- ${action}`);
  } else {
    lines.push('- none');
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildGateGap,
  buildSplitGap,
  buildReadinessReport,
  renderReadinessMarkdown,
};
