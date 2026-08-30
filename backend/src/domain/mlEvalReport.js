'use strict';

const { HUMAN_LABELS, SCHEMA_VERSION } = require('./mlEvalSnapshot');

const SLICE_FIELDS = ['entity_type', 'kind', 'source_system', 'human_label', 'priority'];
const OUTCOME_LABELS = new Set(['false_positive', 'benign', 'suspicious', 'incident']);
const GOLD_LABEL_SOURCE = 'gold_review';
const DEFAULT_THRESHOLDS = [0, 0.5, 0.7, 0.9];
const DEFAULT_GATE = { minAgreement: 0.8, minCoverage: 0.5, minGoldRecords: 20 };

function parseJsonl(text) {
  const lines = String(text || '').split(/\r?\n/);
  const records = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      throw Object.assign(new Error(`Invalid JSONL at line ${i + 1}: ${err.message}`), { line: i + 1 });
    }
  }
  return records;
}

function increment(map, key) {
  const safeKey = key === undefined || key === null || key === '' ? '_empty' : String(key);
  map.set(safeKey, (map.get(safeKey) || 0) + 1);
}

function toSortedEntries(map) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function summarizeConfidence(records) {
  const values = records
    .map((record) => record.raw_confidence)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return { count: 0, min: null, max: null, mean: null };
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: Number((sum / values.length).toFixed(4)),
  };
}

function buildSlices(records, fields = SLICE_FIELDS) {
  const result = {};
  for (const field of fields) {
    const counts = new Map();
    for (const record of records) increment(counts, record[field]);
    result[field] = toSortedEntries(counts);
  }
  return result;
}

function buildConfusion(records) {
  const nested = new Map();
  for (const record of records) {
    const raw = record.raw_verdict || '_empty';
    const label = record.human_label || '_empty';
    if (!nested.has(raw)) nested.set(raw, new Map());
    increment(nested.get(raw), label);
  }
  return [...nested.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([rawVerdict, labels]) => ({ rawVerdict, labels: toSortedEntries(labels) }));
}

function normalizeOutcome(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'fp' || text === 'false_positive') return 'false_positive';
  if (OUTCOME_LABELS.has(text)) return text;
  return null;
}

function buildOutcomeAgreement(records) {
  const matrix = new Map();
  let comparable = 0;
  let correct = 0;
  let skipped = 0;

  for (const record of records) {
    const expected = normalizeOutcome(record.human_label);
    const predicted = normalizeOutcome(record.raw_verdict);
    if (!expected || !predicted) {
      skipped += 1;
      continue;
    }
    comparable += 1;
    if (expected === predicted) correct += 1;
    if (!matrix.has(predicted)) matrix.set(predicted, new Map());
    increment(matrix.get(predicted), expected);
  }

  return {
    comparable,
    correct,
    skipped,
    agreement: comparable ? Number((correct / comparable).toFixed(4)) : null,
    matrix: [...matrix.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([predicted, labels]) => ({ predicted, labels: toSortedEntries(labels) })),
  };
}

function comparableOutcomeRows(records) {
  return records
    .map((record) => ({
      expected: normalizeOutcome(record.human_label),
      predicted: normalizeOutcome(record.raw_verdict),
      confidence: typeof record.raw_confidence === 'number' && Number.isFinite(record.raw_confidence)
        ? record.raw_confidence
        : null,
    }))
    .filter((row) => row.expected && row.predicted);
}

function buildThresholdSweep(records, thresholds = DEFAULT_THRESHOLDS) {
  const rows = comparableOutcomeRows(records);
  return thresholds.map((threshold) => {
    const accepted = rows.filter((row) => row.confidence !== null && row.confidence >= threshold);
    const correct = accepted.filter((row) => row.expected === row.predicted).length;
    return {
      threshold,
      comparable: rows.length,
      accepted: accepted.length,
      correct,
      routedToReview: rows.length - accepted.length,
      coverage: rows.length ? Number((accepted.length / rows.length).toFixed(4)) : null,
      agreement: accepted.length ? Number((correct / accepted.length).toFixed(4)) : null,
    };
  });
}

function normalizeGateConfig(config = {}) {
  const minAgreement = Number(config.minAgreement ?? DEFAULT_GATE.minAgreement);
  const minCoverage = Number(config.minCoverage ?? DEFAULT_GATE.minCoverage);
  const minGoldRecords = Number(config.minGoldRecords ?? DEFAULT_GATE.minGoldRecords);
  return {
    minAgreement: Number.isFinite(minAgreement) ? Math.max(0, Math.min(1, minAgreement)) : DEFAULT_GATE.minAgreement,
    minCoverage: Number.isFinite(minCoverage) ? Math.max(0, Math.min(1, minCoverage)) : DEFAULT_GATE.minCoverage,
    minGoldRecords: Number.isFinite(minGoldRecords) ? Math.max(0, Math.floor(minGoldRecords)) : DEFAULT_GATE.minGoldRecords,
  };
}

function evaluateRoutingGate({ goldSummary, gate = DEFAULT_GATE } = {}) {
  const cfg = normalizeGateConfig(gate);
  const failures = [];
  const goldTotal = goldSummary?.total || 0;
  const sweep = goldSummary?.thresholdSweep || [];
  const candidates = sweep.filter((row) =>
    row.accepted > 0 &&
    row.agreement !== null &&
    row.coverage !== null &&
    row.agreement >= cfg.minAgreement &&
    row.coverage >= cfg.minCoverage);

  if (goldTotal < cfg.minGoldRecords) {
    failures.push(`gold_records ${goldTotal} < ${cfg.minGoldRecords}`);
  }
  if (!candidates.length) {
    failures.push(`no_threshold_meets agreement>=${cfg.minAgreement} and coverage>=${cfg.minCoverage}`);
  }

  return {
    status: failures.length ? 'fail' : 'pass',
    gate: cfg,
    selected: failures.length ? null : candidates[0],
    candidates,
    failures,
  };
}

function isGoldRecord(record) {
  return record && record.label_source === GOLD_LABEL_SOURCE;
}

function validateGoldRecord(record, line) {
  const warnings = [];
  if (!isGoldRecord(record)) return warnings;
  if (!normalizeOutcome(record.human_label)) {
    warnings.push({ line, code: 'gold_human_label_not_outcome', message: 'gold_review requires an outcome human_label' });
  }
  if (!normalizeOutcome(record.raw_verdict)) {
    warnings.push({ line, code: 'gold_raw_verdict_not_outcome', message: 'gold_review requires an outcome raw_verdict' });
  }
  if (!record.reviewed_at) {
    warnings.push({ line, code: 'gold_reviewed_at_missing', message: 'gold_review requires reviewed_at' });
  }
  if (!String(record.human_reason || '').trim()) {
    warnings.push({ line, code: 'gold_human_reason_missing', message: 'gold_review requires a redacted human_reason' });
  }
  return warnings;
}

function buildGoldSummary(records) {
  const goldRecords = records.filter(isGoldRecord);
  return {
    total: goldRecords.length,
    outcomeAgreement: buildOutcomeAgreement(goldRecords),
    slices: buildSlices(goldRecords, ['kind', 'source_system', 'human_label', 'priority']),
    thresholdSweep: buildThresholdSweep(goldRecords),
  };
}

function validateEvalRecords(records) {
  const warnings = [];
  records.forEach((record, index) => {
    const line = index + 1;
    if (record.schema_version !== SCHEMA_VERSION) warnings.push({ line, code: 'schema_version', message: `Expected ${SCHEMA_VERSION}` });
    if (!record.entity_type) warnings.push({ line, code: 'entity_type_missing', message: 'entity_type is required' });
    if (!record.entity_id) warnings.push({ line, code: 'entity_id_missing', message: 'entity_id is required' });
    if (!record.human_label) warnings.push({ line, code: 'human_label_missing', message: 'human_label is required' });
    if (record.human_label && !HUMAN_LABELS.has(record.human_label)) {
      warnings.push({ line, code: 'human_label_unknown', message: `Unknown human_label ${record.human_label}` });
    }
    if (record.raw_confidence !== null && record.raw_confidence !== undefined) {
      const value = record.raw_confidence;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        warnings.push({ line, code: 'raw_confidence_range', message: 'raw_confidence must be null or 0..1' });
      }
    }
    warnings.push(...validateGoldRecord(record, line));
  });
  return warnings;
}

function summarizeEvalRecords(records, options = {}) {
  const warnings = validateEvalRecords(records);
  const gold = buildGoldSummary(records);
  return {
    schemaVersion: SCHEMA_VERSION,
    total: records.length,
    warnings,
    confidence: summarizeConfidence(records),
    slices: buildSlices(records),
    confusion: buildConfusion(records),
    outcomeAgreement: buildOutcomeAgreement(records),
    thresholdSweep: buildThresholdSweep(records),
    gold,
    routingGate: evaluateRoutingGate({ goldSummary: gold, gate: options.gate }),
  };
}

function renderMarkdownReport(summary) {
  const lines = [
    '# Nexora ML Eval Report',
    '',
    `Schema: ${summary.schemaVersion}`,
    `Records: ${summary.total}`,
    `Warnings: ${summary.warnings.length}`,
    '',
    '## Confidence',
    '',
    `Count: ${summary.confidence.count}`,
    `Min: ${summary.confidence.min ?? 'n/a'}`,
    `Max: ${summary.confidence.max ?? 'n/a'}`,
    `Mean: ${summary.confidence.mean ?? 'n/a'}`,
    '',
    '## Slices',
    '',
  ];

  for (const [field, entries] of Object.entries(summary.slices)) {
    lines.push(`### ${field}`, '');
    for (const entry of entries) lines.push(`- ${entry.value}: ${entry.count}`);
    lines.push('');
  }

  lines.push('## Raw Verdict vs Human Label', '');
  for (const row of summary.confusion) {
    const cells = row.labels.map((entry) => `${entry.value}=${entry.count}`).join(', ');
    lines.push(`- ${row.rawVerdict}: ${cells}`);
  }

  lines.push('', '## Outcome Agreement', '');
  lines.push(`Comparable: ${summary.outcomeAgreement.comparable}`);
  lines.push(`Correct: ${summary.outcomeAgreement.correct}`);
  lines.push(`Skipped: ${summary.outcomeAgreement.skipped}`);
  lines.push(`Agreement: ${summary.outcomeAgreement.agreement ?? 'n/a'}`, '');
  for (const row of summary.outcomeAgreement.matrix) {
    const cells = row.labels.map((entry) => `${entry.value}=${entry.count}`).join(', ');
    lines.push(`- ${row.predicted}: ${cells}`);
  }

  lines.push('', '## Threshold Sweep', '');
  for (const row of summary.thresholdSweep) {
    lines.push(`- >=${row.threshold}: accepted=${row.accepted}/${row.comparable}, correct=${row.correct}, review=${row.routedToReview}, coverage=${row.coverage ?? 'n/a'}, agreement=${row.agreement ?? 'n/a'}`);
  }

  lines.push('', '## Gold Review Subset', '');
  lines.push(`Records: ${summary.gold.total}`);
  lines.push(`Comparable: ${summary.gold.outcomeAgreement.comparable}`);
  lines.push(`Correct: ${summary.gold.outcomeAgreement.correct}`);
  lines.push(`Skipped: ${summary.gold.outcomeAgreement.skipped}`);
  lines.push(`Agreement: ${summary.gold.outcomeAgreement.agreement ?? 'n/a'}`);
  lines.push('Gold Threshold Sweep:');
  for (const row of summary.gold.thresholdSweep) {
    lines.push(`- >=${row.threshold}: accepted=${row.accepted}/${row.comparable}, correct=${row.correct}, review=${row.routedToReview}, coverage=${row.coverage ?? 'n/a'}, agreement=${row.agreement ?? 'n/a'}`);
  }

  lines.push('', '## Routing Gate', '');
  lines.push(`Status: ${summary.routingGate.status}`);
  lines.push(`Min agreement: ${summary.routingGate.gate.minAgreement}`);
  lines.push(`Min coverage: ${summary.routingGate.gate.minCoverage}`);
  lines.push(`Min gold records: ${summary.routingGate.gate.minGoldRecords}`);
  if (summary.routingGate.selected) {
    lines.push(`Selected threshold: >=${summary.routingGate.selected.threshold}`);
  }
  if (summary.routingGate.failures.length) {
    lines.push('Failures:');
    for (const failure of summary.routingGate.failures) lines.push(`- ${failure}`);
  }

  if (summary.warnings.length) {
    lines.push('', '## Warnings', '');
    for (const warning of summary.warnings) {
      lines.push(`- line ${warning.line} ${warning.code}: ${warning.message}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  SLICE_FIELDS,
  GOLD_LABEL_SOURCE,
  DEFAULT_THRESHOLDS,
  DEFAULT_GATE,
  parseJsonl,
  validateEvalRecords,
  normalizeOutcome,
  buildOutcomeAgreement,
  buildThresholdSweep,
  normalizeGateConfig,
  evaluateRoutingGate,
  isGoldRecord,
  validateGoldRecord,
  buildGoldSummary,
  summarizeEvalRecords,
  renderMarkdownReport,
};
