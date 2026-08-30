'use strict';

const Joi = require('joi');

/**
 * Validierung für PUT /api/v1/otrs/connection (Layer 2, In-UI-Admin).
 * OTRS/Znuny läuft on-prem (http intern) ODER hinter TLS → http/https erlaubt,
 * Loopback/Metadaten deny-List in der Route.
 *   - baseUrl leer erlaubt = Verbindung löschen (→ ENV),
 *   - username Pflicht bei gesetzter URL (Route/Service prüfen),
 *   - otrsPassword leer = unverändert (maskiertes Feld),
 *   - queue/webService/operation optional (Defaults im Service),
 *   - password (Step-up) Pflicht,
 *   - Max-Längen gegen Payload-Missbrauch.
 */
const otrsConnectionSchema = Joi.object({
  password:     Joi.string().min(1).max(1024).required(),   // Admin-Step-up
  baseUrl:      Joi.string().uri({ scheme: ['http', 'https'] }).max(512).allow(''),
  username:     Joi.string().max(256).allow(''),
  otrsPassword: Joi.string().max(1024).allow(''),           // OTRS-Agent-Passwort
  queue:        Joi.string().max(128).allow(''),
  webService:   Joi.string().max(128).allow(''),
  operation:    Joi.string().max(128).allow(''),
});

module.exports = { otrsConnectionSchema };
