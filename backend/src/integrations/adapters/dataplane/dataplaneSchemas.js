'use strict';

const Joi = require('joi');

// FusedIncident-Contract (Data Plane Korrelierungs-Engine, ADR-035). Bereits
// normalisiert + größen-gedeckelt — der Adapter prüft Form, nicht Vendor-Rohdaten.
const fusedIncidentSchema = Joi.object({
  incidentId: Joi.string().pattern(/^[0-9a-f]{64}$/).required(),
  fusionKey: Joi.string().max(300).required(),
  domains: Joi.array().items(Joi.string().max(40)).min(1).max(20).required(),
  sources: Joi.array().items(Joi.object().unknown(true)).max(200).optional(),
  severity: Joi.string().valid('info', 'low', 'medium', 'high', 'critical').required(),
  verdict: Joi.string().valid('observed', 'suspicious', 'confirmed_malicious').required(),
  network: Joi.object().unknown(true).allow(null).optional(),
  entities: Joi.array().items(Joi.object({
    type: Joi.string().max(40).required(),
    value: Joi.string().max(300).required(),
    role: Joi.string().max(40).allow(null, ''),
  })).max(100).optional(),
  // Sitzungs-Aktivität (Cowrie-Honeypot): der Angreifer-Schritt je Event, von der
  // Fusion gesammelt. Additiv, bereits gedeckelt. Passwort ist per Contract nie enthalten.
  sessionActivity: Joi.array().items(Joi.object({
    kind: Joi.string().valid('command', 'login', 'download', 'tunnel').required(),
    value: Joi.string().max(2000).allow('').optional(),
    user: Joi.string().max(2000).allow('').optional(),
    at: Joi.string().isoDate().optional(),
  })).max(50).optional(),
  signatures: Joi.array().items(Joi.string().max(500)).max(50).optional(),
  mitre: Joi.array().items(Joi.string().max(40)).max(50).optional(),
  firewallActions: Joi.array().items(Joi.string().max(40)).max(10).optional(),
  confidence: Joi.number().min(0).max(1).allow(null).optional(),
  eventCount: Joi.number().integer().min(1).required(),
  eventIds: Joi.array().items(Joi.string().max(64)).max(1000).optional(),
  windowStart: Joi.string().isoDate().allow(null).optional(),
  windowEnd: Joi.string().isoDate().allow(null).optional(),
}).unknown(false);

module.exports = { fusedIncidentSchema };
