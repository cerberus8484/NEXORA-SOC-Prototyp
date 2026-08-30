'use strict';

const logger = require('../logger');

// Jeder Request wird geloggt — Basis für späteres Audit-Logging
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    logger.info('http_request', {
      requestId:  req.id,
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      durationMs: Date.now() - start,
      ip:         req.ip,
      userAgent:  req.get('user-agent'),
    });
  });

  next();
}

module.exports = requestLogger;
