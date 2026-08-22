'use strict';

const Joi = require('joi');
const { PAYLOAD_TYPES } = require('../Payload');

const createPayloadSchema = Joi.object({
  ticketId    : Joi.string().uuid().required(),
  type        : Joi.string().valid(...PAYLOAD_TYPES).allow('').default(''),
  raw         : Joi.string().max(50000).allow('').default(''),
  rawHash     : Joi.string().max(64).allow('').default(''),
  fields      : Joi.object().default({}),
  decoded     : Joi.string().max(10000).allow('').default(''),
  parserNotes : Joi.string().max(2000).allow('').default(''),
  confidence  : Joi.number().integer().min(0).max(100).allow(null).default(null),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = { createPayloadSchema };
