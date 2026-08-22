'use strict';

const crypto = require('crypto');

const SCHEMA_VERSION = 'v1';
const HUMAN_LABELS = new Set([
  'accepted',
  'rejected',
  'false_positive',
  'benign',
  'suspicious',
  'incident',
  'resolved_other',
]);

function cleanString(value, { max = 200 } = {}) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeConfidence(value, scale = 1) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const normalized = scale === 100 ? n / 100 : n;
  return Math.max(0, Math.min(1, normalized));
}

function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ticketHumanLabel(ticket) {
  if (ticket.closeReason === 'false_positive') return 'false_positive';
  if (ticket.decision === 'benign') return 'benign';
  if (ticket.decision === 'suspicious') return 'suspicious';
  if (ticket.decision === 'incident') return 'incident';
  return 'resolved_other';
}

function suggestionHumanLabel(suggestion) {
  if (suggestion.status === 'approved') return 'accepted';
  if (suggestion.status === 'rejected') return 'rejected';
  return null;
}

function assertKnownHumanLabel(label) {
  if (label !== null && !HUMAN_LABELS.has(label)) {
    throw new Error(`Unknown ML eval human_label: ${label}`);
  }
}

function mapAgentSuggestionToEvalRecord(suggestion) {
  const humanLabel = suggestionHumanLabel(suggestion);
  assertKnownHumanLabel(humanLabel);
  return {
    schema_version: SCHEMA_VERSION,
    entity_type: 'agent_suggestion',
    entity_id: cleanString(suggestion.id, { max: 80 }),
    ticket_id: cleanString(suggestion.ticketId, { max: 80 }),
    label_source: 'agent_review',
    source_kind: 'agent_review',
    kind: cleanString(suggestion.kind, { max: 80 }),
    source_system: 'agent',
    source_model: cleanString(suggestion.model, { max: 120 }),
    raw_verdict: cleanString(suggestion.verdict, { max: 80 }),
    raw_confidence: normalizeConfidence(suggestion.confidence),
    review_status: cleanString(suggestion.status, { max: 40 }),
    human_label: humanLabel,
    human_reason: cleanString(suggestion.reviewReason, { max: 200 }),
    close_reason: '',
    priority: '',
    created_at: isoOrNull(suggestion.createdAt),
    reviewed_at: isoOrNull(suggestion.reviewedAt),
  };
}

function mapTicketToEvalRecord(ticket) {
  const humanLabel = ticketHumanLabel(ticket);
  assertKnownHumanLabel(humanLabel);
  return {
    schema_version: SCHEMA_VERSION,
    entity_type: 'ticket',
    entity_id: cleanString(ticket.id, { max: 80 }),
    ticket_id: cleanString(ticket.id, { max: 80 }),
    label_source: 'ticket_outcome',
    source_kind: 'ticket_close',
    kind: cleanString(ticket.kind, { max: 80 }),
    source_system: cleanString(ticket.source, { max: 80 }),
    source_model: '',
    raw_verdict: cleanString(ticket.decision, { max: 80 }),
    raw_confidence: normalizeConfidence(ticket.confidence, 100),
    review_status: cleanString(ticket.state, { max: 40 }),
    human_label: humanLabel,
    human_reason: '',
    close_reason: cleanString(ticket.closeReason, { max: 80 }),
    priority: cleanString(ticket.priority, { max: 40 }),
    created_at: isoOrNull(ticket.createdAt),
    reviewed_at: isoOrNull(ticket.updatedAt),
  };
}

function toJsonl(records) {
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
}

function buildSnapshotDigest(records) {
  return crypto.createHash('sha256').update(toJsonl(records), 'utf8').digest('hex');
}

function buildCountMap(records, field) {
  return records.reduce((acc, record) => {
    const key = String(record?.[field] || '_empty');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function buildSnapshotMeta(records, { generatedAt = new Date().toISOString() } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: isoOrNull(generatedAt) || new Date().toISOString(),
    recordCount: records.length,
    recordSha256: buildSnapshotDigest(records),
    labelSourceCounts: buildCountMap(records, 'label_source'),
    humanLabelCounts: buildCountMap(records, 'human_label'),
  };
}

module.exports = {
  SCHEMA_VERSION,
  HUMAN_LABELS,
  cleanString,
  normalizeConfidence,
  mapAgentSuggestionToEvalRecord,
  mapTicketToEvalRecord,
  buildSnapshotDigest,
  buildSnapshotMeta,
  toJsonl,
};
