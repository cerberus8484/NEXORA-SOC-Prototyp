'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Deployment Center — paramSchema-Validierung (fail-fast am System-Rand).
//
// Kompiliert das deklarative module.paramSchema (deployModuleCatalog) in ein
// Joi-Schema und validiert die Deploy-Parameter, BEVOR sie je in eine Spec,
// einen Plan oder ein config.xml-Rendering fließen (Injection-Prävention).
//
// Secrets (adminPassword …) werden vorab hart abgelehnt — sie gehören NIE in
// die persistierten Params (write-only, fließen separat zur Apply-Zeit).
// ─────────────────────────────────────────────────────────────────────────

const Joi = require('joi');
const { ValidationError } = require('../errors/AppError');
const { assertNoSecrets } = require('./deployDomain');
const { NETWORK_PARAM_SCHEMA } = require('./deployModuleCatalog');

const IPV4 = { version: ['ipv4'], cidr: 'forbidden' };

// Ein einzelnes paramSchema-Feld → Joi-Basistyp (ohne Präsenz-Regeln).
function baseJoi(spec) {
  switch (spec.type) {
    case 'hostname': return Joi.string().hostname().max(253);
    case 'enum':     return Joi.string().valid(...(spec.values || []));
    case 'ipv4':     return Joi.string().ip(IPV4);
    case 'ipv4[]': {
      let arr = Joi.array().items(Joi.string().ip(IPV4));
      if (spec.minItems != null) arr = arr.min(spec.minItems);
      if (spec.maxItems != null) arr = arr.max(spec.maxItems);
      return arr;
    }
    case 'integer': {
      let n = Joi.number().integer();
      if (spec.min != null) n = n.min(spec.min);
      if (spec.max != null) n = n.max(spec.max);
      return n;
    }
    case 'string': {
      let str = Joi.string().max(200);
      if (spec.pattern) str = str.pattern(new RegExp(spec.pattern));
      return str;
    }
    default:       return Joi.any();
  }
}

// Feld inkl. Präsenz-Regeln: `when` (bedingt Pflicht, z.B. nur bei ipMode=static)
// hat Vorrang vor `required`. `default` wird gesetzt, wenn vorhanden.
function fieldToJoi(spec) {
  let j = baseJoi(spec);
  if (spec.default !== undefined) j = j.default(spec.default);
  if (spec.when && spec.when.ipMode) {
    j = j.when('ipMode', { is: spec.when.ipMode, then: Joi.required(), otherwise: Joi.optional() });
  } else if (spec.required) {
    j = j.required();
  }
  return j;
}

function schemaFromParamSchema(paramSchema) {
  const keys = {};
  for (const [name, spec] of Object.entries(paramSchema)) keys[name] = fieldToJoi(spec);
  return Joi.object(keys).options({ abortEarly: false, stripUnknown: true });
}

function runValidation(paramSchema, params) {
  const input = params && typeof params === 'object' ? params : {};
  assertNoSecrets(input, 'params.'); // wirft { status: 400 } bei Secret-Schlüssel
  const { error, value } = schemaFromParamSchema(paramSchema).validate(input);
  if (error) throw new ValidationError(`Ungültige Deploy-Parameter: ${error.message}`, error.details);
  return { value };
}

/** Validiert Params gegen das vollständige paramSchema eines System-Moduls. */
function validateAgainstModule(module, params) {
  if (!module || typeof module.paramSchema !== 'object') {
    throw new ValidationError('validateAgainstModule: ungültiges Modul (paramSchema fehlt)');
  }
  return runValidation(module.paramSchema, params);
}

/** Validiert nur den gemeinsamen Netzwerk-Block (ohne vendor-spezifische Felder). */
function validateNetworkBlock(params) {
  return runValidation(NETWORK_PARAM_SCHEMA, params);
}

module.exports = { validateAgainstModule, validateNetworkBlock, schemaFromParamSchema };
