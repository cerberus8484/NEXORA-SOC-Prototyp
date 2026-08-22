'use strict';

const Joi = require('joi');

// Validierung eines CrowdSec-Alerts (LAPI /v1/alerts bzw. `cscli alerts list -o json`).
// Bewusst lenient (.unknown(true)) — CrowdSec-Felder variieren je Version/Collection;
// Pflicht ist nur, was wir für ein sinnvolles Ticket brauchen: scenario + source.value.

const sourceSchema = Joi.object({
  scope:     Joi.string().allow('').optional(),
  value:     Joi.string().required(),          // IP oder CIDR — der Indikator
  ip:        Joi.string().allow('').optional(),
  as_number: Joi.alternatives(Joi.string(), Joi.number()).allow('').optional(),
  as_name:   Joi.string().allow('').optional(),
  cn:        Joi.string().allow('').optional(),
  latitude:  Joi.number().optional(),
  longitude: Joi.number().optional(),
}).unknown(true);

const decisionSchema = Joi.object({
  origin:    Joi.string().allow('').optional(),
  type:      Joi.string().allow('').optional(),
  scope:     Joi.string().allow('').optional(),
  value:     Joi.string().allow('').optional(),
  duration:  Joi.string().allow('').optional(),
  scenario:  Joi.string().allow('').optional(),
  simulated: Joi.boolean().optional(),
}).unknown(true);

const alertSchema = Joi.object({
  id:           Joi.alternatives(Joi.number(), Joi.string()).optional(),
  scenario:     Joi.string().required(),
  message:      Joi.string().allow('').optional(),
  events_count: Joi.number().optional(),
  start_at:     Joi.string().allow('').optional(),
  stop_at:      Joi.string().allow('').optional(),
  created_at:   Joi.string().allow('').optional(),
  simulated:    Joi.boolean().optional(),
  source:       sourceSchema.required(),
  decisions:    Joi.array().items(decisionSchema).optional(),
}).unknown(true);

module.exports = { alertSchema };
