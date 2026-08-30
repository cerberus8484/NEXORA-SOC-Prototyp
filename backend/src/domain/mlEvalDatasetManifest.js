'use strict';

function buildDatasetManifest({
  datasetName = 'ml-eval-dataset',
  snapshotMeta,
  summary,
  sourceFile = '',
} = {}) {
  if (!snapshotMeta) throw new Error('snapshotMeta is required');
  if (!summary) throw new Error('summary is required');

  return {
    datasetName: String(datasetName || 'ml-eval-dataset'),
    generatedAt: snapshotMeta.generatedAt,
    schemaVersion: snapshotMeta.schemaVersion,
    sourceFile: String(sourceFile || ''),
    snapshot: {
      recordCount: snapshotMeta.recordCount,
      recordSha256: snapshotMeta.recordSha256,
      labelSourceCounts: snapshotMeta.labelSourceCounts,
      humanLabelCounts: snapshotMeta.humanLabelCounts,
    },
    quality: {
      warnings: summary.warnings.length,
      routingGate: {
        status: summary.routingGate.status,
        gate: summary.routingGate.gate,
        selectedThreshold: summary.routingGate.selected ? summary.routingGate.selected.threshold : null,
        failures: summary.routingGate.failures,
      },
      outcomeAgreement: summary.outcomeAgreement,
      goldRecords: summary.gold.total,
    },
  };
}

module.exports = { buildDatasetManifest };
