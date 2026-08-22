'use strict';

// Joi-Body-Schema für Host-Enrollment (POST /hosts). Der Agent-Name geht an die
// Wazuh-API — eng auf einen sicheren Zeichensatz begrenzt (kein Whitespace/Shell).
const Joi = require('joi');

const addHostSchema = Joi.object({
  name: Joi.string().pattern(/^[a-zA-Z0-9._-]{1,128}$/).required(),
  ip:   Joi.string().ip({ version: ['ipv4'], cidr: 'forbidden' }),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = { addHostSchema };
