'use strict';

const Joi = require('joi');

/**
 * Validierung für PUT /api/v1/settings/oidc (In-UI-Admin, P1 #6).
 *
 * Patch-Semantik: alle Felder optional, mind. eines. Sicherheits-Constraints:
 *   - issuer NUR https (OIDC-Discovery läuft über TLS).
 *   - defaultRole NIE 'admin' — kein Auto-Admin via SSO-Signup (PoLA).
 *   - clientSecret leer = unverändert (maskiertes UI-Feld überschreibt nicht).
 */
const oidcConfigSchema = Joi.object({
  enabled:      Joi.boolean(),
  issuer:       Joi.string().uri({ scheme: ['https'] }).max(512).allow(''),
  clientId:     Joi.string().max(256).allow(''),
  clientSecret: Joi.string().max(2048).allow(''),
  redirectUri:  Joi.string().uri({ scheme: ['https', 'http'] }).max(512).allow(''),
  scope:        Joi.string().max(256).allow(''),
  defaultRole:  Joi.string().valid('viewer', 'analyst', 'engineer'),
  allowSignup:  Joi.boolean(),
}).min(1);

module.exports = { oidcConfigSchema };
