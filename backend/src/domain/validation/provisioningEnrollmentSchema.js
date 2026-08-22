'use strict';

/**
 * Joi-Validierungsschemas für Provisioning-Enrollment-Routes (P_AGENT_1).
 * Konsistent zu anderen Schema-Dateien unter domain/validation/.
 */

const Joi = require('joi');
const { CAPABILITIES } = require('../../provisioning/provisioningDomain');

const ipItem = Joi.string().max(64);

// POST /enrollment-profiles (admin)
const createEnrollmentProfileSchema = Joi.object({
  name:         Joi.string().max(200).required(),
  role:         Joi.string().max(100).required(),
  capabilities: Joi.array().items(Joi.string().valid(...CAPABILITIES)).default([]),
  expiresAt:    Joi.string().isoDate().allow(null),
}).options({ abortEarly: false, stripUnknown: true });

// POST /enrollment-profiles/:id/token (admin)
const mintTokenSchema = Joi.object({
  ttlSeconds: Joi.number().integer().min(60).max(2592000), // 1 min … 30 Tage
}).options({ abortEarly: false, stripUnknown: true });

// POST /enroll (Node; Token im Body ODER Authorization-Bearer-Header)
const enrollSchema = Joi.object({
  token:        Joi.string().max(200).allow('', null),
  hostname:     Joi.string().max(255).required(),
  platform:     Joi.string().max(100).allow('', null),
  version:      Joi.string().max(100).allow('', null),
  ips:          Joi.array().items(ipItem).default([]),
  labels:       Joi.object().pattern(Joi.string(), Joi.string()).default({}),
  capabilities: Joi.array().items(Joi.string().valid(...CAPABILITIES)).default([]),
}).options({ abortEarly: false, stripUnknown: true });

// POST /nodes/:id/heartbeat (Node; Token via Authorization-Bearer-Header)
const heartbeatSchema = Joi.object({
  nodeId:       Joi.string().max(100), // optional/informativ; maßgeblich ist :id aus der URL
  status:       Joi.string().max(40),
  version:      Joi.string().max(100).allow('', null),
  hostname:     Joi.string().max(255).allow('', null),
  ips:          Joi.array().items(ipItem).default([]),
  observedAt:   Joi.string().isoDate(),
  capabilities: Joi.array().items(Joi.string().valid(...CAPABILITIES)).default([]),
}).options({ abortEarly: false, stripUnknown: true });

// POST /nodes/:id/credentials/:credId/revoke (admin) — optionaler Grund, begrenzt.
const revokeCredentialSchema = Joi.object({
  reason: Joi.string().max(200).allow('', null),
}).options({ abortEarly: false, stripUnknown: true });

// POST /nodes/:id/retire (admin) — optionaler Grund, begrenzt.
const retireNodeSchema = Joi.object({
  reason: Joi.string().max(200).allow('', null),
}).options({ abortEarly: false, stripUnknown: true });

// GET /nodes — Query (admin, read-only)
const listNodesSchema = Joi.object({
  limit:  Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
}).options({ abortEarly: false, stripUnknown: true });

// GET /audit — Query (admin, read-only)
const listAuditSchema = Joi.object({
  type:      Joi.string().max(100),
  subjectId: Joi.string().max(100),
  limit:     Joi.number().integer().min(1).max(200).default(100),
  offset:    Joi.number().integer().min(0).default(0),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = {
  createEnrollmentProfileSchema,
  mintTokenSchema,
  enrollSchema,
  heartbeatSchema,
  revokeCredentialSchema,
  retireNodeSchema,
  listNodesSchema,
  listAuditSchema,
};
