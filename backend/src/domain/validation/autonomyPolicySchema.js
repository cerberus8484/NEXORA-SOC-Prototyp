'use strict';

/**
 * Joi-Validierungsschemas für AutonomyPolicy-Routes.
 * Konsistent zu anderen Schema-Dateien unter domain/validation/.
 */

const Joi = require('joi');
const { ACTION_CLASSES, MODES, VERDICTS } = require('../AutonomyPolicy');

// POST / — Pflichtfelder
const createAutonomyPolicySchema = Joi.object({
  customer:             Joi.string().max(200).default('*'),
  actionClass:          Joi.string().valid(...ACTION_CLASSES).required(),
  mode:                 Joi.string().valid(...MODES).default('advisory'),
  minVerdict:           Joi.string().valid(...VERDICTS).default('confirmed_incident'),
  minConfidence:        Joi.number().min(0).max(1).default(0.9),
  requireEvidenceFloor: Joi.boolean().default(true),
  maxPerHour:           Joi.number().integer().min(0).default(0),
  enabled:              Joi.boolean().default(false),
  createdBy:            Joi.string().max(200).allow('').default(''),
}).options({ abortEarly: false, stripUnknown: true });

// PUT /:id — alle Felder optional
const updateAutonomyPolicySchema = Joi.object({
  customer:             Joi.string().max(200),
  mode:                 Joi.string().valid(...MODES),
  minVerdict:           Joi.string().valid(...VERDICTS),
  minConfidence:        Joi.number().min(0).max(1),
  requireEvidenceFloor: Joi.boolean(),
  maxPerHour:           Joi.number().integer().min(0),
  enabled:              Joi.boolean(),
  createdBy:            Joi.string().max(200).allow(''),
}).options({ abortEarly: false, stripUnknown: true });

// GET / — Query-Parameter
const listAutonomyPoliciesSchema = Joi.object({
  limit:  Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = {
  createAutonomyPolicySchema,
  updateAutonomyPolicySchema,
  listAutonomyPoliciesSchema,
};
