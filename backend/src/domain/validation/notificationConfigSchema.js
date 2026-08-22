'use strict';

const Joi = require('joi');

/**
 * Validierung für PUT /api/v1/notifications/config (Layer 2, In-UI-Admin).
 *
 * Patch-Semantik: alle Felder optional. Sicherheits-/Robustheits-Constraints:
 *   - SMTP-Port als Integer 1–65535 (kein stilles Coerce auf Default),
 *   - Webhook-URLs NUR http/https (kein file:/ftp:/gopher: → SSRF/LFI-Fläche),
 *   - Secrets (pass, *WebhookUrl) leer erlaubt = unverändert (maskiertes Feld),
 *   - Max-Längen gegen Payload-Missbrauch.
 */
const emailSchema = Joi.object({
  host:   Joi.string().max(255).allow(''),
  port:   Joi.number().integer().min(1).max(65535),
  secure: Joi.boolean(),
  user:   Joi.string().max(255).allow(''),
  pass:   Joi.string().max(1024).allow(''),
  from:   Joi.string().max(320).allow(''),
  to:     Joi.string().max(2048).allow(''),   // kommagetrennte Empfängerliste
});

const webhookUrl = Joi.string().uri({ scheme: ['http', 'https'] }).max(2048).allow('');

const notificationConfigSchema = Joi.object({
  outboundEnabled:   Joi.boolean(),
  email:             emailSchema,
  slackWebhookUrl:   webhookUrl,
  genericWebhookUrl: webhookUrl,
  teamsWebhookUrl:   webhookUrl,
});

module.exports = { notificationConfigSchema };
