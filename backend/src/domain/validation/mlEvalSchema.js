'use strict';

const Joi = require('joi');

const mlEvalExportSchema = Joi.object({
  include: Joi.string().valid('all', 'agent_suggestions', 'tickets').default('all'),
  format: Joi.string().valid('jsonl', 'json').default('jsonl'),
  limit: Joi.number().integer().min(1).max(1000).default(100),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = { mlEvalExportSchema };
