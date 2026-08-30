'use strict';

const Joi = require('joi');

/**
 * QRadar Offense Webhook Payload Schema.
 *
 * QRadar sendet Offense-Daten via Custom Actions oder REST.
 * Nur Felder die tatsächlich kommen — kein über-striktes Schema.
 *
 * Referenz: QRadar REST API /siem/offenses/{id}
 */
const offensePayloadSchema = Joi.object({
  // Pflicht: Offense-Identifikation
  id:          Joi.alternatives().try(Joi.number().integer(), Joi.string()).required(),

  // Klassifizierung
  description:    Joi.string().max(5000).allow('', null).default(''),
  offense_name:   Joi.string().max(500).allow('', null).default(''),
  offense_type:   Joi.number().integer().allow(null).default(null),
  severity:       Joi.number().integer().min(0).max(10).default(5),
  credibility:    Joi.number().integer().min(0).max(10).allow(null).default(null),
  relevance:      Joi.number().integer().min(0).max(10).allow(null).default(null),
  magnitude:      Joi.number().integer().min(0).max(10).allow(null).default(null),

  // Status
  status:         Joi.string().valid('OPEN','CLOSED','HIDDEN').default('OPEN'),
  close_time:     Joi.number().allow(null).default(null),
  start_time:     Joi.number().allow(null).default(null),       // Unix ms
  last_updated_time: Joi.number().allow(null).default(null),

  // Netzwerk-Entitäten
  source_address_ids:            Joi.array().items(Joi.number()).default([]),
  local_destination_address_ids: Joi.array().items(Joi.number()).default([]),
  source_count:                  Joi.number().integer().default(0),
  destination_count:             Joi.number().integer().default(0),

  // Bereits aufgelöste Adressen (optionales Feld aus einigen QRadar Custom Actions)
  source_ips:      Joi.array().items(Joi.string()).default([]),
  dest_ips:        Joi.array().items(Joi.string()).default([]),

  // Kategorisierung
  categories:      Joi.array().items(Joi.string()).default([]),
  rules:           Joi.array().items(Joi.object()).default([]),
  log_sources:     Joi.array().items(Joi.object()).default([]),

  // User
  username_count:  Joi.number().integer().default(0),
  assigned_to:     Joi.string().max(200).allow('', null).default(''),

  // Domain
  domain_id:       Joi.number().integer().allow(null).default(null),
  domain_name:     Joi.string().max(200).allow('', null).default(''),

}).options({ allowUnknown: true, stripUnknown: false }); // QRadar kann beliebige Felder senden

module.exports = { offensePayloadSchema };
