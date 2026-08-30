'use strict';

const Joi = require('joi');

// Schema für GET /audit — Query-Parameter
// limit: 1..200, default 50; offset: >=0, default 0
// action, targetType, targetId: optionale Filter-Strings
const auditQuerySchema = Joi.object({
  limit:      Joi.number().integer().min(1).max(200).default(50),
  offset:     Joi.number().integer().min(0).default(0),
  action:     Joi.string().max(100).allow('').optional(),
  targetType: Joi.string().max(100).allow('').optional(),
  targetId:   Joi.string().max(200).allow('').optional(),
  // A6a: Volltext-Suche über erlaubte Felder (Actor/Action/Target) — serverseitig, gedeckelt.
  search:     Joi.string().max(200).allow('').optional(),
}).options({ abortEarly: false, stripUnknown: true });

// A6c: Audit-Export (POST /audit/export). Gleiche Filter wie die Liste + Format.
// Kein limit/offset im Body — die Obergrenze setzt die Route fest (AUDIT_EXPORT_MAX).
const auditExportSchema = Joi.object({
  action:     Joi.string().max(100).allow('').optional(),
  targetType: Joi.string().max(100).allow('').optional(),
  targetId:   Joi.string().max(200).allow('').optional(),
  search:     Joi.string().max(200).allow('').optional(),
  format:     Joi.string().valid('csv', 'pdf').default('csv'),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = { auditQuerySchema, auditExportSchema };
