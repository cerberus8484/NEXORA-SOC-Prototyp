'use strict';

function normalizeOutcome(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'fp' || text === 'false_positive') return 'false_positive';
  if (['false_positive', 'benign', 'suspicious', 'incident'].includes(text)) return text;
  return null;
}

function evaluateThreshold(records, threshold) {
  const comparable = records
    .map((record) => ({
      expected: normalizeOutcome(record.human_label),
      predicted: normalizeOutcome(record.raw_verdict),
      confidence: typeof record.raw_confidence === 'number' && Number.isFinite(record.raw_confidence)
        ? record.raw_confidence
        : null,
    }))
    .filter((row) => row.expected && row.predicted);

  const accepted = comparable.filter((row) => row.confidence !== null && row.confidence >= threshold);
  const correct = accepted.filter((row) => row.expected === row.predicted).length;
  return {
    threshold,
    total: records.length,
    comparable: comparable.length,
    accepted: accepted.length,
    routedToReview: comparable.length - accepted.length,
    correct,
    agreement: accepted.length ? Number((correct / accepted.length).toFixed(4)) : null,
    coverage: comparable.length ? Number((accepted.length / comparable.length).toFixed(4)) : null,
  };
}

function buildBaselineEvaluation({ runManifest, splitRecordsByName } = {}) {
  if (!runManifest) throw new Error('runManifest is required');
  if (!splitRecordsByName) throw new Error('splitRecordsByName is required');

  const selectedThreshold = runManifest.gates?.routingGate?.selectedThreshold;
  if (runManifest.status !== 'ready') {
    return {
      runName: runManifest.runName,
      generatedAt: new Date().toISOString(),
      status: 'blocked',
      blockers: runManifest.blockers || [],
      selectedThreshold: selectedThreshold ?? null,
      splits: {},
    };
  }
  if (typeof selectedThreshold !== 'number') {
    return {
      runName: runManifest.runName,
      generatedAt: new Date().toISOString(),
      status: 'blocked',
      blockers: ['missing_selected_threshold'],
      selectedThreshold: null,
      splits: {},
    };
  }

  return {
    runName: runManifest.runName,
    generatedAt: new Date().toISOString(),
    status: 'ok',
    blockers: [],
    selectedThreshold,
    splits: {
      train: evaluateThreshold(splitRecordsByName.train || [], selectedThreshold),
      validation: evaluateThreshold(splitRecordsByName.validation || [], selectedThreshold),
      test: evaluateThreshold(splitRecordsByName.test || [], selectedThreshold),
    },
  };
}

function renderBaselineMarkdown(result) {
  const lines = [
    '# Nexora ML Baseline Run',
    '',
    `Run: ${result.runName}`,
    `Status: ${result.status}`,
  ];
  if (result.selectedThreshold !== null) lines.push(`Selected threshold: >=${result.selectedThreshold}`);
  if (result.blockers?.length) {
    lines.push('', '## Blockers', '');
    for (const blocker of result.blockers) lines.push(`- ${blocker}`);
  }
  if (result.status === 'ok') {
    lines.push('', '## Splits', '');
    for (const [name, metrics] of Object.entries(result.splits)) {
      lines.push(`### ${name}`, '');
      lines.push(`- comparable=${metrics.comparable}/${metrics.total}`);
      lines.push(`- accepted=${metrics.accepted}`);
      lines.push(`- review=${metrics.routedToReview}`);
      lines.push(`- correct=${metrics.correct}`);
      lines.push(`- coverage=${metrics.coverage ?? 'n/a'}`);
      lines.push(`- agreement=${metrics.agreement ?? 'n/a'}`, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  normalizeOutcome,
  evaluateThreshold,
  buildBaselineEvaluation,
  renderBaselineMarkdown,
};
