'use strict';

// Joi-Schemas für die NIS2-Write-Routes (P_NIS2_1). Grundform-Validierung;
// die Security-Validierung (URL/Secret-Refs, HTML, not_applicable-Begründung)
// macht die Domain (Nis2Assessment/Nis2EvidenceLink).

const Joi = require('joi');
const { ASSESSMENT_STATUS } = require('../../compliance/nis2/Nis2Assessment');
const { EVIDENCE_TYPES } = require('../../compliance/nis2/Nis2EvidenceLink');

// PUT /assessments/:controlKey — alle Felder optional (Partial-Update).
const putAssessmentSchema = Joi.object({
  status:         Joi.string().valid(...ASSESSMENT_STATUS),
  owner:          Joi.string().max(120).allow(''),
  dueDate:        Joi.string().isoDate().allow(null, ''),
  notes:          Joi.string().max(4000).allow(''),
  lastReviewedAt: Joi.string().isoDate().allow(null, ''),
}).options({ abortEarly: false, stripUnknown: true });

// POST /assessments/:controlKey/evidence — Pflichtfelder evidenceType/evidenceRef/title.
const addEvidenceSchema = Joi.object({
  evidenceType: Joi.string().valid(...EVIDENCE_TYPES).required(),
  evidenceRef:  Joi.string().max(1024).required(),
  title:        Joi.string().max(200).required(),
  description:  Joi.string().max(2000).allow(''),
  capturedAt:   Joi.string().isoDate().allow(null, ''),
}).options({ abortEarly: false, stripUnknown: true });

// POST /controls/:controlKey/incident-evidence — Incident-Ticket verknüpfen.
const linkIncidentSchema = Joi.object({
  ticketId: Joi.string().max(100).required(),
}).options({ abortEarly: false, stripUnknown: true });

module.exports = { putAssessmentSchema, addEvidenceSchema, linkIncidentSchema };
