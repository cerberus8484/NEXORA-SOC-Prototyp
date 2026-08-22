'use strict';

const Joi = require('joi');

// Joi-Schema für eingehende Dataplane-Status-Snapshots (POST /dataplane/status).
// Der Push-Job des Dataplane-Knotens meldet hier periodisch (HMAC-gesichert).
// Strikt typisiert — keine freien JSON-Blobs; unbekannte Felder werden entfernt.
// KEINE Secrets/PII erwartet (nur Betriebszähler + Collector-Namen/-Zustände).

const COLLECTOR_STATES = ['pending', 'running', 'stopped', 'completed', 'failed'];

const collectorSchema = Joi.object({
  name: Joi.string().max(200).required(),
  kind: Joi.string().max(100).allow('').default(''),
  status: Joi.string().valid(...COLLECTOR_STATES).required(),
  emitted: Joi.number().integer().min(0).default(0),
  error: Joi.string().max(2000).allow(null, '').default(null),
});

const intakeSchema = Joi.object({
  total: Joi.number().integer().min(0).default(0),
  accepted: Joi.number().integer().min(0).default(0),
  rejected: Joi.number().integer().min(0).default(0),
  duplicate: Joi.number().integer().min(0).default(0),
  pending: Joi.number().integer().min(0).default(0),
}).default();

const outboxSchema = Joi.object({
  pending: Joi.number().integer().min(0).default(0),
  processing: Joi.number().integer().min(0).default(0),
  completed: Joi.number().integer().min(0).default(0),
  retrying: Joi.number().integer().min(0).default(0),
  failed: Joi.number().integer().min(0).default(0),
  oldestPendingAt: Joi.string().isoDate().allow(null).default(null),
}).default();

const dataplaneStatusSnapshotSchema = Joi.object({
  nodeId: Joi.string().max(200).required(),
  reportedAt: Joi.string().isoDate().required(),
  collectors: Joi.array().items(collectorSchema).max(500).default([]),
  intake: intakeSchema,
  outbox: outboxSchema,
}).required();

module.exports = { dataplaneStatusSnapshotSchema, COLLECTOR_STATES };
