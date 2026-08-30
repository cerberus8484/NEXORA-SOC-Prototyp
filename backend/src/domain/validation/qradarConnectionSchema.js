'use strict';

const Joi = require('joi');

/**
 * Validierung für PUT /api/v1/qradar/connection (Layer 2, In-UI-Admin).
 *   - baseUrl NUR https (QRadar-REST-API läuft über TLS) — leer erlaubt = Sektion löschen,
 *   - token leer erlaubt = unverändert (maskiertes Feld),
 *   - password (Step-up) Pflicht,
 *   - Max-Längen gegen Payload-Missbrauch.
 */
const qradarConnectionSchema = Joi.object({
  password: Joi.string().min(1).max(1024).required(),
  baseUrl:  Joi.string().uri({ scheme: ['https'] }).max(512).allow(''),
  token:    Joi.string().max(2048).allow(''),
});

module.exports = { qradarConnectionSchema };
