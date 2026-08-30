'use strict';

const { randomUUID } = require('crypto');

// Jeder Request bekommt eine eindeutige ID — für Traceability und Debugging
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
