'use strict';

const Joi = require('joi');

const HUNT_TYPE_KEYS = [
  'suspicious_powershell_hunt', 'opnsense_multicast_review', 'rdp_exposure_hunt',
  'persistence_hunt', 'failed_logon_hunt', 'dns_tunneling_hunt',
  'scheduled_tasks_hunt', 'services_hunt', 'autoruns_hunt', 'remote_access_tools_hunt',
];

const createSessionSchema = Joi.object({
  ticketId:   Joi.string().uuid().optional().allow(null, ''),
  targetHost: Joi.string().min(1).max(255).required(),
  scope:      Joi.string().max(1000).optional().allow(''),
  hypothesis: Joi.string().max(2000).optional().allow(''),
  // Hunt-Runner (additiv, optional):
  huntType:   Joi.string().valid(...HUNT_TYPE_KEYS).optional().allow(''),
  title:      Joi.string().max(300).optional().allow(''),
  riskLevel:  Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  targetType: Joi.string().valid('host', 'ip', 'ticket', 'group').optional(),
  sourceIp:      Joi.string().max(64).optional().allow(''),
  destinationIp: Joi.string().max(64).optional().allow(''),
});

const failSessionSchema = Joi.object({
  reason: Joi.string().max(500).optional().allow(''),
});

const addNoteSchema = Joi.object({
  content: Joi.string().min(1).max(5000).required(),
});

const listSessionsSchema = Joi.object({
  ticketId:  Joi.string().uuid().optional(),
  analystId: Joi.string().optional(),
});

// ─── Command Schemas ──────────────────────────────────────────────────────────

const VALID_COMMAND_TYPES = [
  'manual', 'osquery', 'yara', 'sigma',
  'powershell', 'bash', 'log_search', 'network_scan',
];

const createCommandSchema = Joi.object({
  type:        Joi.string().valid(...VALID_COMMAND_TYPES).required(),
  command:     Joi.string().min(1).max(10000).required(),
  description: Joi.string().max(1000).optional().allow(''),
});

const completeCommandSchema = Joi.object({
  stdout:   Joi.string().max(50000).optional().allow(''),
  stderr:   Joi.string().max(10000).optional().allow(''),
  exitCode: Joi.number().integer().optional().allow(null),
});

const failCommandSchema = Joi.object({
  reason:   Joi.string().max(500).optional().allow(''),
  stderr:   Joi.string().max(10000).optional().allow(''),
  exitCode: Joi.number().integer().optional().allow(null),
});

const blockCommandSchema = Joi.object({
  reason: Joi.string().max(500).optional().allow(''),
});

// ─── Artifact / Finding Schemas ───────────────────────────────────────────────

const VALID_ARTIFACT_TYPES = [
  'file', 'process', 'network_conn', 'registry_key',
  'user_account', 'log_entry', 'ioc', 'memory_region', 'other',
];

const createArtifactSchema = Joi.object({
  type:     Joi.string().valid(...VALID_ARTIFACT_TYPES).required(),
  value:    Joi.string().min(1).max(2000).required(),
  commandId: Joi.string().uuid().optional().allow(null, ''),
  metadata: Joi.object().optional(),
  source:   Joi.string().max(200).optional().allow(''),
});

const VALID_SEVERITIES  = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_CONFIDENCES  = ['high', 'medium', 'low'];

const createFindingSchema = Joi.object({
  title:          Joi.string().min(1).max(300).required(),
  description:    Joi.string().max(5000).optional().allow(''),
  severity:       Joi.string().valid(...VALID_SEVERITIES).required(),
  confidence:     Joi.string().valid(...VALID_CONFIDENCES).optional(),
  artifactIds:    Joi.array().items(Joi.string()).optional(),
  mitreAttack:    Joi.string().max(100).optional().allow(''),
  recommendation: Joi.string().max(2000).optional().allow(''),
});

// ─── Ticket-Link Schema (P13.4) ───────────────────────────────────────────────

const linkTicketSchema = Joi.object({
  ticketId: Joi.string().min(1).required(),
});

// ─── Finding-Verdict Schema (Block B2) ────────────────────────────────────────

const VALID_VERDICTS = ['', 'benign', 'suspicious', 'malicious', 'inconclusive'];

const setFindingVerdictSchema = Joi.object({
  verdict: Joi.string().valid(...VALID_VERDICTS).required().messages({
    'any.only': `verdict muss einer von: ${VALID_VERDICTS.filter(v => v !== '').join(', ')} oder leer sein`,
    'any.required': 'verdict ist Pflichtfeld',
  }),
});

module.exports = {
  createSessionSchema,
  failSessionSchema,
  addNoteSchema,
  listSessionsSchema,
  createCommandSchema,
  completeCommandSchema,
  failCommandSchema,
  blockCommandSchema,
  createArtifactSchema,
  createFindingSchema,
  linkTicketSchema,
  setFindingVerdictSchema,
};
