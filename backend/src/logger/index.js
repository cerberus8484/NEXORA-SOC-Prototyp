'use strict';

const { createLogger, format, transports } = require('winston');
const config = require('../config');

const logger = createLogger({
  level: config.log.level,
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()               // Strukturiertes JSON-Logging für SIEM-Kompatibilität
  ),
  defaultMeta: { service: 'soc-ticket-api' },
  transports: [
    new transports.Console({
      format: config.env === 'development'
        ? format.combine(format.colorize(), format.simple())
        : format.json(),
    }),
  ],
});

module.exports = logger;
