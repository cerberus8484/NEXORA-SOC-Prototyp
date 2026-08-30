'use strict';

const Joi = require('joi');

/**
 * E-Mail Webhook Payload Schema.
 *
 * Eingang ist eine normalisierte Mail-Repräsentation, wie sie ein
 * E-Mail-Gateway / Forwarder oder der IMAP-Poller liefert.
 * Nur die Felder die tatsächlich gebraucht werden — allowUnknown,
 * damit Gateways beliebige Zusatzfelder (raw headers etc.) mitschicken können.
 *
 * Pflicht: ein Identifikator (messageId) ODER subject — sonst kein sinnvolles Ticket.
 * messageId ist der bevorzugte Dedup-Schlüssel.
 */
const emailPayloadSchema = Joi.object({
  // Identifikation / Dedup — KEIN default(''), sonst würde .or('messageId','subject')
  // immer erfüllt sein (Joi wertet Defaults als "präsent").
  messageId: Joi.string().max(998).allow('', null),

  // Absender / Empfänger
  from: Joi.string().max(998).allow('', null).default(''),
  to:   Joi.alternatives()
          .try(Joi.string().max(2000), Joi.array().items(Joi.string().max(998)))
          .allow('', null)
          .default(''),

  // Inhalt
  subject: Joi.string().max(2000).allow('', null),
  // body und text sind Aliase — Gateways nutzen mal das eine, mal das andere
  body: Joi.string().max(100000).allow('', null).default(''),
  text: Joi.string().max(100000).allow('', null).default(''),

  // Zeitstempel (ISO 8601 oder RFC 2822 — wird im Mapper geparst)
  receivedAt: Joi.string().max(100).allow('', null).default(''),
  date:       Joi.string().max(100).allow('', null).default(''),

  // Optionale Roh-Header (Objekt key→value)
  headers: Joi.object().unknown(true).default({}),
})
  .or('messageId', 'subject')
  .options({ allowUnknown: true, stripUnknown: false });

module.exports = { emailPayloadSchema };
