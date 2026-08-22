'use strict';

// Joi-Body-Schema für Manual-Host anlegen (POST /hosts/manual).
// Kein externer Aufruf — die Daten landen nur in der eigenen DB. Trotzdem eng
// validiert (Länge/Zeichensatz), damit die Host-Liste sauber bleibt (kein Shell/
// HTML-Missbrauch; Ausgabe im Frontend erfolgt ohnehin nur als textContent).
const Joi = require('joi');

const manualHostSchema = Joi.object({
  hostname:    Joi.string().pattern(/^[a-zA-Z0-9._-]{1,253}$/).required(),
  ipAddresses: Joi.array().items(Joi.string().ip({ version: ['ipv4'], cidr: 'forbidden' })).max(16).default([]),
  os:          Joi.string().max(128).allow('').default(''),
  customer:    Joi.string().max(128).allow('').default(''),
  notes:       Joi.string().max(1000).allow('').default(''),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = { manualHostSchema };
