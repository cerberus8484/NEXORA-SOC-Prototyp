'use strict';

const Joi = require('joi');

/**
 * Validierung für PUT /api/v1/servicenow/connection (Layer 2, In-UI-Admin).
 * ServiceNow ist eine TLS-Instanz (SaaS oder Enterprise) → nur https.
 *   - baseUrl leer erlaubt = Verbindung löschen (→ ENV),
 *   - username Pflicht bei gesetzter URL (Route/Service prüfen),
 *   - servicenowPassword leer = unverändert (maskiertes Feld),
 *   - password (Step-up) Pflicht,
 *   - Max-Längen gegen Payload-Missbrauch.
 */
const servicenowConnectionSchema = Joi.object({
  password:           Joi.string().min(1).max(1024).required(),   // Admin-Step-up
  baseUrl:            Joi.string().uri({ scheme: ['https'] }).max(512).allow(''),
  username:           Joi.string().max(256).allow(''),
  servicenowPassword: Joi.string().max(1024).allow(''),            // ServiceNow-Account-Passwort
  table:              Joi.string().max(64).allow(''),
});

module.exports = { servicenowConnectionSchema };
