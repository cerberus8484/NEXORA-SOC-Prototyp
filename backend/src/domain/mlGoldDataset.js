'use strict';

const { parseJsonl, validateEvalRecords, isGoldRecord } = require('./mlEvalReport');
const { toJsonl } = require('./mlEvalSnapshot');

function validateGoldDataset(records) {
  const warnings = validateEvalRecords(records);
  const nonGold = records
    .map((record, index) => ({ record, line: index + 1 }))
    .filter(({ record }) => !isGoldRecord(record))
    .map(({ line }) => ({ line, code: 'not_gold_record', message: 'dataset contains non-gold record' }));
  return [...warnings, ...nonGold];
}

function mergeGoldRecords(baseRecords, incomingRecords) {
  const byId = new Map();
  for (const record of baseRecords) {
    byId.set(String(record.entity_id), record);
  }
  for (const record of incomingRecords) {
    byId.set(String(record.entity_id), record);
  }
  return [...byId.values()].sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id)));
}

function buildGoldMergeResult({ baseText = '', incomingText = '' } = {}) {
  const baseRecords = parseJsonl(baseText);
  const incomingRecords = parseJsonl(incomingText);
  const baseWarnings = validateGoldDataset(baseRecords);
  const incomingWarnings = validateGoldDataset(incomingRecords);
  const mergedRecords = mergeGoldRecords(baseRecords, incomingRecords);
  const mergedWarnings = validateGoldDataset(mergedRecords);

  return {
    baseRecords,
    incomingRecords,
    mergedRecords,
    warnings: {
      base: baseWarnings,
      incoming: incomingWarnings,
      merged: mergedWarnings,
    },
    output: toJsonl(mergedRecords),
  };
}

module.exports = {
  validateGoldDataset,
  mergeGoldRecords,
  buildGoldMergeResult,
};
