'use strict';

/**
 * nis2-Router — /api/v1/nis2  (P_NIS2_1)
 *
 * NIS2 **Readiness & Evidence** — Arbeits-/Nachweis-Unterstützung, KEIN
 * Konformitätsnachweis, keine Zertifizierung, kein Rechtsgutachten.
 *
 * RBAC: Lesen für alle authentifizierten Rollen (viewer+); Schreiben nur admin.
 * Jede Schreibaktion erzeugt Audit-Events mit NUR sicheren Metadaten.
 */

const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { NIS2_CONTROLS, CATALOG_VERSION } = require('../compliance/nis2/nis2ControlCatalog');
const { Nis2ReadinessService } = require('../compliance/nis2/Nis2ReadinessService');
const { createNis2Repository } = require('../repositories/nis2RepositoryFactory');
const { auditService } = require('../services/AuditService');
const { putAssessmentSchema, addEvidenceSchema, linkIncidentSchema } = require('../domain/validation/nis2Schema');

const router = Router();

// Eine geteilte Repo-Instanz in den Service (InMemory teilt keinen State über
// mehrere Factory-Aufrufe — gleiche Falle wie im Provisioning-Modul).
const repo = createNis2Repository();
const service = new Nis2ReadinessService({ repo, audit: auditService });

function actorFrom(req) {
  return { userId: req.user?.sub || null, label: req.user?.email || req.user?.sub || '', ip: req.ip || '' };
}

// ─── Read (viewer+) ───────────────────────────────────────────────────────

// GET /controls — Readiness-Übersicht (Katalog + Summary + berechnete Flags).
router.get('/controls', requireAuth, requireRole('viewer'), async (req, res, next) => {
  try {
    const result = await service.getReadiness();
    res.json({ data: result.controls, summary: result.summary, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /report — Management-Readiness-Report (Aggregat, rein lesend, ehrlich).
router.get('/report', requireAuth, requireRole('viewer'), async (req, res, next) => {
  try {
    const data = await service.getManagementReport();
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /catalog — reiner statischer Katalog (ohne Assessment-Status).
router.get('/catalog', requireAuth, requireRole('viewer'), (req, res) => {
  res.json({ data: NIS2_CONTROLS, version: CATALOG_VERSION, requestId: req.id });
});

// GET /assessments — alle gespeicherten Assessments.
router.get('/assessments', requireAuth, requireRole('viewer'), async (req, res, next) => {
  try {
    const data = await repo.listAssessments();
    res.json({ data, total: data.length, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /assessments/:controlKey — Control-Detail inkl. Evidence-Liste.
router.get('/assessments/:controlKey', requireAuth, requireRole('viewer'), async (req, res, next) => {
  try {
    const detail = await service.getControlDetail(req.params.controlKey);
    res.json({ data: detail, requestId: req.id });
  } catch (err) { next(err); }
});

// ─── Write (admin) ────────────────────────────────────────────────────────

// PUT /assessments/:controlKey — Assessment anlegen/aktualisieren.
router.put('/assessments/:controlKey', requireAuth, requireRole('admin'), validate(putAssessmentSchema), async (req, res, next) => {
  try {
    const saved = await service.upsertAssessment(req.params.controlKey, req.body, actorFrom(req));
    res.json({ data: saved, requestId: req.id });
  } catch (err) { next(err); }
});

// POST /assessments/:controlKey/evidence — Evidence-Link hinzufügen.
router.post('/assessments/:controlKey/evidence', requireAuth, requireRole('admin'), validate(addEvidenceSchema), async (req, res, next) => {
  try {
    const saved = await service.addEvidence(req.params.controlKey, req.body, actorFrom(req));
    res.status(201).json({ data: saved, requestId: req.id });
  } catch (err) { next(err); }
});

// POST /controls/:controlKey/incident-evidence — Incident-Ticket als Evidence verknüpfen.
router.post('/controls/:controlKey/incident-evidence', requireAuth, requireRole('admin'), validate(linkIncidentSchema), async (req, res, next) => {
  try {
    const saved = await service.linkIncident(req.params.controlKey, req.body, actorFrom(req));
    res.status(201).json({ data: saved, requestId: req.id });
  } catch (err) { next(err); }
});

// DELETE /evidence/:id — Evidence-Link entfernen (mit Audit).
router.delete('/evidence/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    await service.removeEvidence(req.params.id, actorFrom(req));
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
