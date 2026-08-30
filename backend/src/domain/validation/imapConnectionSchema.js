'use strict';

const Joi = require('joi');

/**
 * Validierung für PUT /api/v1/imap/connection (Layer 2, In-UI-Admin).
 * IMAP-Postfach (self-hosted Mailserver, i.d.R. intern) — rohe TCP-Verbindung, kein
 * HTTP-URL. Host als Hostname/IP, Port 1–65535. Die Route blockt zusätzlich
 * Metadaten-/Link-local-Hosts (Defense-in-Depth).
 *   - host leer erlaubt = Sektion löschen (→ ENV),
 *   - user/imapPassword Pflicht bei gesetztem Host (Service prüft),
 *   - imapPassword leer = unverändert (maskiertes Feld),
 *   - password (Step-up) Pflicht.
 */
const imapConnectionSchema = Joi.object({
  password:     Joi.string().min(1).max(1024).required(),   // Admin-Step-up
  host:         Joi.string().hostname().max(253).allow(''),
  port:         Joi.number().integer().min(1).max(65535),
  user:         Joi.string().max(320).allow(''),
  imapPassword: Joi.string().max(1024).allow(''),           // IMAP-Postfach-Passwort
  secure:       Joi.boolean(),
});

module.exports = { imapConnectionSchema };
