'use strict';

const Joi = require('joi');

/**
 * Wazuh Alert Webhook Payload Schema.
 *
 * Wazuh sendet Alerts via /etc/ossec/ossec.conf <integration> → custom webhook.
 * Format: { id, rule, agent, manager, timestamp, location, data, full_log, ... }
 *
 * Referenz: Wazuh Alert Fields — https://documentation.wazuh.com/current/user-manual/ruleset/ruleset-xml-syntax/rules.html
 */
const alertPayloadSchema = Joi.object({
  // Pflicht: Alert-ID oder mindestens ein Rule-Objekt
  id: Joi.alternatives().try(Joi.string(), Joi.number()).allow('', null).default(''),

  // Rule — Kern des Wazuh-Alerts
  rule: Joi.object({
    id:          Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    level:       Joi.number().integer().min(0).max(15).required(),
    description: Joi.string().max(5000).allow('', null).default(''),
    groups:      Joi.array().items(Joi.string()).default([]),
    mitre: Joi.object({
      id:        Joi.array().items(Joi.string()).default([]),
      tactic:    Joi.array().items(Joi.string()).default([]),
      technique: Joi.array().items(Joi.string()).default([]),
    }).default({}),
  }).required(),

  // Agent — betroffener Host
  agent: Joi.object({
    id:   Joi.alternatives().try(Joi.string(), Joi.number()).allow('', null).default(''),
    name: Joi.string().max(200).allow('', null).default(''),
    ip:   Joi.string().max(100).allow('', null).default(''),
  }).default({}),

  // Manager
  manager: Joi.object({
    name: Joi.string().max(200).allow('', null).default(''),
  }).default({}),

  // Zeitstempel (ISO 8601 oder Unix ms)
  timestamp: Joi.alternatives().try(Joi.string(), Joi.number()).allow('', null).default(null),

  // Log-Quelle
  location: Joi.string().max(500).allow('', null).default(''),

  // Dynamische Payload-Felder — Quelldaten je nach Decoder
  data: Joi.object({
    srcip:   Joi.string().max(100).allow('', null).default(''),
    dstip:   Joi.string().max(100).allow('', null).default(''),
    srcport: Joi.alternatives().try(Joi.number(), Joi.string()).allow(null).default(''),
    dstport: Joi.alternatives().try(Joi.number(), Joi.string()).allow(null).default(''),
    srcuser: Joi.string().max(200).allow('', null).default(''),
    dstuser: Joi.string().max(200).allow('', null).default(''),
  }).default({}).unknown(true),

  // Originallog
  full_log: Joi.string().max(10000).allow('', null).default(''),

}).options({ allowUnknown: true, stripUnknown: false }); // Wazuh-Decoder-Felder variieren stark

module.exports = { alertPayloadSchema };
