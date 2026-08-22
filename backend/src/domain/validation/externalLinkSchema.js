'use strict';

const Joi = require('joi');
const { EXTERNAL_SYSTEMS, SYNC_DIRECTIONS } = require('../ExternalLink');

const createExternalLinkSchema = Joi.object({
  internalTicketId : Joi.string().uuid().required(),
  externalSystem   : Joi.string().valid(...EXTERNAL_SYSTEMS).required(),
  externalId       : Joi.string().max(200).required(),
  externalUrl      : Joi.string().uri().allow('').default(''),
  syncDirection    : Joi.string().valid(...SYNC_DIRECTIONS).default('inbound'),
  rawPayloadHash   : Joi.string().max(64).allow('').default(''),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = { createExternalLinkSchema };
