'use strict';

const Joi = require('joi');
const { EVIDENCE_TYPES, EVIDENCE_SOURCES } = require('../Evidence');

const createEvidenceSchema = Joi.object({
  ticketId       : Joi.string().uuid().required(),
  payloadId      : Joi.string().uuid().allow(null, '').default(null),
  type           : Joi.string().valid(...EVIDENCE_TYPES).default('log_entry'),
  source         : Joi.string().valid(...EVIDENCE_SOURCES).default('manual'),
  title          : Joi.string().max(200).required(),
  logSource      : Joi.string().max(100).allow('').default(''),
  eventId        : Joi.string().max(100).allow('').default(''),
  query          : Joi.string().max(5000).allow('').default(''),
  rawText        : Joi.string().max(5 * 1024 * 1024).allow('').default(''),
  content        : Joi.string().max(5 * 1024 * 1024).allow('').default(''), // Datei-Import: roher Datei-Text
  filename       : Joi.string().max(255).allow('').default(''),
  eventTimestamp : Joi.string().isoDate().allow(null, '').default(null),
  confidence     : Joi.number().integer().min(0).max(100).allow(null).default(null),
  comment        : Joi.string().max(5000).allow('').default(''),
  collectedBy    : Joi.string().max(100).allow('').default(''),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = { createEvidenceSchema };
