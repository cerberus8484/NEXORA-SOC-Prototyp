'use strict';

const { ValidationError } = require('../errors/AppError');

// Middleware-Factory: Schema gegen req.body oder req.query validieren
// Nutzung: router.post('/', validate(createTicketSchema), handler)
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = source === 'query' ? req.query : req.body;

    const { error, value } = schema.validate(data, {
      abortEarly:    false,
      stripUnknown:  true,
    });

    if (error) {
      const details = error.details.map(d => ({
        field:   d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      return next(new ValidationError('Validation failed', details));
    }

    // Validierten + bereinigten Wert speichern
    // Express 5: req.query ist read-only → validatedQuery nutzen
    if (source === 'query') req.validatedQuery = value;
    else {
      // Original gesendete Feldnamen merken (für Audit) — Joi füllt Defaults auf
      req.rawBodyKeys = Object.keys(data || {});
      req.body = value;
    }

    next();
  };
}

module.exports = validate;
