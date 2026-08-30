'use strict';

const Joi = require('joi');

/**
 * Validierung für PUT /api/v1/rag/qdrant-connection (Layer 2, In-UI-Admin).
 * Qdrant ist ein interner Vektor-Store → URL http/https auf internen Host
 * (Deny-List gegen Loopback-Missbrauch greift zusätzlich in der Route).
 *   - url leer erlaubt = Sektion löschen (→ ENV),
 *   - apiKey optional + leer = unverändert (Qdrant kann ohne Auth laufen),
 *   - password (Step-up) Pflicht.
 */
const qdrantConnectionSchema = Joi.object({
  password: Joi.string().min(1).max(1024).required(),
  url:      Joi.string().uri({ scheme: ['http', 'https'] }).max(512).allow(''),
  apiKey:   Joi.string().max(2048).allow(''),
});

module.exports = { qdrantConnectionSchema };
