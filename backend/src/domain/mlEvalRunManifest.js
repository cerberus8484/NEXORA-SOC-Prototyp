'use strict';

function buildRunManifest({
  runName = 'baseline-run',
  datasetManifest,
  splitManifest,
  objective = 'offline_eval_baseline',
  strategy = 'rule_baseline',
  notes = '',
  config = {},
} = {}) {
  if (!datasetManifest) throw new Error('datasetManifest is required');
  if (!splitManifest) throw new Error('splitManifest is required');

  return {
    runName: String(runName || 'baseline-run'),
    generatedAt: new Date().toISOString(),
    objective: String(objective || 'offline_eval_baseline'),
    strategy: String(strategy || 'rule_baseline'),
    notes: String(notes || ''),
    dataset: {
      datasetName: datasetManifest.datasetName,
      datasetSha256: datasetManifest.snapshot.recordSha256,
      generatedAt: datasetManifest.generatedAt,
    },
    split: {
      splitName: splitManifest.splitName,
      seed: splitManifest.seed,
      ratios: splitManifest.ratios,
      counts: splitManifest.counts,
      splitQuality: splitManifest.splitQuality,
      splitSha256: splitManifest.splitSha256,
    },
    gates: {
      routingGate: datasetManifest.quality.routingGate,
    },
    config: {
      ...config,
    },
    status: splitManifest.splitQuality?.status === 'ok' && datasetManifest.quality?.routingGate?.status === 'pass'
      ? 'ready'
      : 'blocked',
    blockers: [
      ...(datasetManifest.quality?.routingGate?.status === 'pass'
        ? []
        : [`routing_gate_${datasetManifest.quality?.routingGate?.status || 'fail'}`]),
      ...((splitManifest.splitQuality?.warnings || []).map((warning) => `split_${warning}`)),
    ],
  };
}

module.exports = { buildRunManifest };
