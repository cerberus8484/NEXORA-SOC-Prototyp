'use strict';

// P_CONFIG_1 — /api/v1/config — Configuration Capability Registry (Slice 1).
//
// RBAC: read = jede authentifizierte Rolle · create/edit/submit = engineer|admin ·
// approve/reject = admin. KEIN Apply-Endpunkt (approved ≠ applied).
// Unknown Capability/Target = deny (Service). Antworten sind redigiert (Service).

const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { ConfigRegistryService } = require('../configRegistry/ConfigRegistryService');
const { getConfigRepository } = require('../configRegistry/configRepositoryFactory');
const { createDraftSchema, updateDraftSchema, submitSchema, decisionSchema } = require('../domain/validation/configSchema');

const router = Router();

function service() { return new ConfigRegistryService({ repo: getConfigRepository() }); }
function actorFrom(req) { return { id: req.user?.sub, role: req.user?.role, label: req.user?.email || req.user?.sub || '' }; }

// ── Read (Allowlist + Risikoanzeige) ────────────────────────────────────────
router.get('/capabilities', requireAuth, (req, res, next) => {
  try { res.json({ data: service().listCapabilities(), requestId: req.id }); } catch (err) { next(err); }
});
router.get('/capabilities/:id', requireAuth, (req, res, next) => {
  try { res.json({ data: service().getCapability(req.params.id), requestId: req.id }); } catch (err) { next(err); }
});
router.get('/targets', requireAuth, (req, res, next) => {
  try { res.json({ data: service().listTargets(), requestId: req.id }); } catch (err) { next(err); }
});

// ── Drafts ──────────────────────────────────────────────────────────────────
router.get('/drafts', requireAuth, async (req, res, next) => {
  try {
    const data = await service().listDrafts({ capabilityId: req.query.capabilityId, targetId: req.query.targetId, status: req.query.status });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

router.post('/drafts', requireAuth, requireRole('engineer', 'admin'), validate(createDraftSchema), async (req, res, next) => {
  try {
    const data = await service().createDraft({ capabilityId: req.body.capabilityId, targetId: req.body.targetId, value: req.body.value, actor: actorFrom(req) });
    res.status(201).json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

router.get('/drafts/:id', requireAuth, async (req, res, next) => {
  try { res.json({ data: await service().getDraft(req.params.id), requestId: req.id }); } catch (err) { next(err); }
});

router.put('/drafts/:id', requireAuth, requireRole('engineer', 'admin'), validate(updateDraftSchema), async (req, res, next) => {
  try {
    const data = await service().updateDraftValue({ draftId: req.params.id, value: req.body.value, expectedVersion: req.body.expectedVersion, actor: actorFrom(req) });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

router.post('/drafts/:id/submit', requireAuth, requireRole('engineer', 'admin'), validate(submitSchema), async (req, res, next) => {
  try {
    const data = await service().submitForApproval({ draftId: req.params.id, expectedVersion: req.body.expectedVersion, actor: actorFrom(req) });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// Freigabe/Ablehnung — admin-only, Vier-Augen-Prinzip im Service. KEIN Apply.
router.post('/drafts/:id/decision', requireAuth, requireRole('admin'), validate(decisionSchema), async (req, res, next) => {
  try {
    const data = await service().decide({ draftId: req.params.id, decision: req.body.decision, expectedVersion: req.body.expectedVersion, note: req.body.note, actor: actorFrom(req) });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

router.get('/drafts/:id/audit', requireAuth, async (req, res, next) => {
  try { res.json({ data: await service().listAudit({ draftId: req.params.id }), requestId: req.id }); } catch (err) { next(err); }
});

// ── P_CORR_ADMIN_2 Stufe 1: separate Validierung + Apply-Plan (KEIN Apply) ──
router.post('/drafts/:id/validate', requireAuth, requireRole('engineer', 'admin'), async (req, res, next) => {
  try { res.json({ data: await service().validateDraft(req.params.id), requestId: req.id }); } catch (err) { next(err); }
});

router.get('/drafts/:id/plan', requireAuth, async (req, res, next) => {
  try { res.json({ data: await service().buildPlan(req.params.id), requestId: req.id }); } catch (err) { next(err); }
});

module.exports = router;
