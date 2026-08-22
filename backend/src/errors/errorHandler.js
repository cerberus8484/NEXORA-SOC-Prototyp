'use strict';

const logger  = require('../logger');
const { AppError } = require('./AppError');

// Zentrale Fehlerbehandlung — kein Fehler verlässt den Server unkontrolliert
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const requestId = req.id || 'unknown';

  if (err instanceof AppError) {
    // 5xx-AppErrors (z.B. abhängiger Dienst down) mit voller Ursache loggen — die
    // bleibt serverseitig; der Client bekommt nur Code + sichere Meldung + requestId.
    if (err.statusCode >= 500) {
      logger.error('app_error', {
        requestId, code: err.code, message: err.message, status: err.statusCode,
        cause: err.cause?.message, stack: err.cause?.stack || err.stack,
      });
    } else {
      logger.warn('app_error', {
        requestId, code: err.code, message: err.message, status: err.statusCode,
      });
    }

    const body = {
      error:     err.code,
      message:   err.message,
      requestId,
    };
    if (err.details?.length) body.details = err.details;
    return res.status(err.statusCode).json(body);
  }

  // Unbekannte Fehler — immer error level + Stack
  logger.error('unhandled_error', {
    requestId,
    message: err.message,
    stack:   err.stack,
  });

  res.status(500).json({
    error:     'INTERNAL_ERROR',
    message:   'An internal error occurred',
    requestId,
  });
}

module.exports = errorHandler;
