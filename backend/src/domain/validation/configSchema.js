'use strict';

// Joi-Schemas für die P_CONFIG_1-Routes. Grundform-Validierung (typisiert,
// keine freien Strings/JSON-Blobs als Body). Die fachliche Wert-Validierung
// gegen das Capability-Schema macht die Domain/der Service (Allowlist).

const Joi = require('joi');

// value ist ein Objekt (kein freier String/Pfad); der Inhalt wird gegen das
// Capability-Schema validiert (Service). Unbekannte Capability/Target → deny.
const createDraftSchema = Joi.object({
  capabilityId: Joi.string().max(200).required(),
  targetId:     Joi.string().max(200).required(),
  value:        Joi.object().required(),
}).options({ abortEarly: false, stripUnknown: true });

const updateDraftSchema = Joi.object({
  value:           Joi.object().required(),
  expectedVersion: Joi.number().integer().min(1).required(),
}).options({ abortEarly: false, stripUnknown: true });

const submitSchema = Joi.object({
  expectedVersion: Joi.number().integer().min(1).required(),
}).options({ abortEarly: false, stripUnknown: true });

const decisionSchema = Joi.object({
  decision:        Joi.string().valid('approved', 'rejected').required(),
  expectedVersion: Joi.number().integer().min(1).required(),
  note:            Joi.string().max(2000).allow('').default(''),
}).options({ abortEarly: false, stripUnknown: true });

// Correlator-skopierte Draft-Erstellung: das Ziel leitet der Correlator selbst
// aus seiner Allowlist ab (configTargetId) — KEIN freies targetId aus dem Body.
const correlatorCreateDraftSchema = Joi.object({
  capabilityId: Joi.string().max(200).required(),
  value:        Joi.object().required(),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = {
  createDraftSchema, updateDraftSchema, submitSchema, decisionSchema,
  correlatorCreateDraftSchema,
};
