'use strict';

const Joi = require('joi');

/**
 * Splunk Alert / Notable Event Webhook Payload Schema.
 *
 * Splunk ES sendet Notables via Alert Action oder REST.
 * Splunk-Feldnamen sind inkonsistent — je nach Datenquelle unterschiedlich.
 * Deshalb: allowUnknown:true, nur Pflichtfeld = result (oder sid/search_name).
 *
 * Referenz: Splunk Enterprise Security Notable Events
 */
const alertPayloadSchema = Joi.object({
  // Pflicht: mindestens eine dieser beiden Identifikationen
  sid:         Joi.string().allow('', null).default(''),        // Search Job ID
  search_name: Joi.string().max(500).allow('', null).default(''), // Alert-Name

  // Ergebnis-Objekt (enthält die eigentlichen Felder)
  result: Joi.object({
    // Notable Event Identifikation
    event_id:     Joi.string().max(500).allow('', null).default(''),
    rule_name:    Joi.string().max(500).allow('', null).default(''),
    rule_title:   Joi.string().max(500).allow('', null).default(''),

    // Klassifizierung
    urgency:      Joi.string().valid('critical','high','medium','low','informational').allow('', null).default('medium'),
    severity:     Joi.string().max(50).allow('', null).default(''),
    type:         Joi.string().max(200).allow('', null).default(''),
    category:     Joi.string().max(200).allow('', null).default(''),

    // Zeitstempel
    _time:        Joi.alternatives().try(Joi.number(), Joi.string()).allow(null).default(null),

    // Netzwerk-Entitäten (viele Feldname-Varianten in Splunk)
    src:          Joi.string().max(100).allow('', null).default(''),
    src_ip:       Joi.string().max(100).allow('', null).default(''),
    src_dns:      Joi.string().max(200).allow('', null).default(''),
    dest:         Joi.string().max(100).allow('', null).default(''),
    dest_ip:      Joi.string().max(100).allow('', null).default(''),
    dest_dns:     Joi.string().max(200).allow('', null).default(''),
    dest_port:    Joi.alternatives().try(Joi.number(), Joi.string()).allow(null).default(''),

    // User
    user:         Joi.string().max(200).allow('', null).default(''),
    src_user:     Joi.string().max(200).allow('', null).default(''),

    // MITRE
    'mitre_technique_id':       Joi.string().max(200).allow('', null).default(''),
    'mitre_technique_name':     Joi.string().max(200).allow('', null).default(''),
    'mitre_tactic':             Joi.string().max(200).allow('', null).default(''),

    // Protokoll
    protocol:     Joi.string().max(50).allow('', null).default(''),

    // Beschreibung
    description:  Joi.string().max(5000).allow('', null).default(''),
    message:      Joi.string().max(5000).allow('', null).default(''),
  }).default({}).unknown(true), // Splunk-Felder sind sehr variabel

  // Splunk Meta
  owner:        Joi.string().max(200).allow('', null).default(''),
  app:          Joi.string().max(200).allow('', null).default(''),

}).options({ allowUnknown: true, stripUnknown: false });

module.exports = { alertPayloadSchema };
