'use strict';

const Joi = require('joi');

/**
 * Validierung für PUT /api/v1/crowdsec/connection (Layer 2, In-UI-Admin).
 * CrowdSec-LAPI kann intern ODER extern (Webserver/VPS) sein → keine Allowlist,
 * aber http/https-Schema-Zwang + Deny-List (Loopback/Metadaten) in der Route.
 *   - baseUrl leer erlaubt = Sektion löschen (→ ENV),
 *   - machineId/password Pflicht bei gesetzter URL (Route/Service prüfen),
 *   - password leer = unverändert (maskiertes Feld),
 *   - password (Step-up) Pflicht.
 */
const crowdsecConnectionSchema = Joi.object({
  password:    Joi.string().min(1).max(1024).required(),   // Admin-Step-up
  baseUrl:     Joi.string().uri({ scheme: ['http', 'https'] }).max(512).allow(''),
  machineId:   Joi.string().max(256).allow(''),
  lapiPassword: Joi.string().max(1024).allow(''),          // CrowdSec-Machine-Passwort
  tlsInsecure: Joi.boolean(),
});

module.exports = { crowdsecConnectionSchema };
