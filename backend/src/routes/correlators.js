'use strict';

// P_CORR_ADMIN_1 — /api/v1/correlators — Correlation Operations Center (Slice 1).
//
// RBAC: read (Registry/Detail/Jobs/Results/Config/Audit) = analyst+ ·
//       Draft erstellen/ändern/einreichen = engineer+ · genehmigen/ablehnen = admin
//       (Vier-Augen-Prinzip im ConfigRegistryService).
// KEIN Apply-/Restart-/Reload-/Exec-Endpunkt. Genehmigt ≠ angewendet.
// Unbekannter Correlator/nicht gebundene Capability = deny (Service/Catalog).

const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { createCorrelatorRegistryService } = require('../correlatorRegistry/correlatorRegistryServiceFactory');
const { createCorrelatorApplyService } = require('../applyChannel/correlatorApplyServiceFactory');
const { correlatorCreateDraftSchema, updateDraftSchema, submitSchema, decisionSchema } = require('../domain/validation/configSchema');

const router = Router();

function service() { return createCorrelatorRegistryService(); }
function applyService() { return createCorrelatorApplyService(); }
function actorFrom(req) { return { id: req.user?.sub, role: req.user?.role, label: req.user?.email || req.user?.sub || '' }; }
function pageParams(req) {
  return {
    limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
    offset: req.query.offset !== undefined ? Number(req.query.offset) : 0,
  };
}

// ── Read (Registry / Detail / Jobs / Results / Config / Audit) — analyst+ ─────
router.get('/', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try { res.json({ data: await service().listCorrelators(), requestId: req.id }); } catch (err) { next(err); }
});

router.get('/:id', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try { res.json({ data: await service().getCorrelator(req.params.id), requestId: req.id }); } catch (err) { next(err); }
});

router.get('/:id/jobs', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const { limit, offset } = pageParams(req);
    const out = await service().listJobs(req.params.id, { status: req.query.status, limit, offset });
    res.json({ data: out.data, total: out.total, requestId: req.id });
  } catch (err) { next(err); }
});

router.get('/:id/results', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const { limit, offset } = pageParams(req);
    const out = await service().listResults(req.params.id, { limit, offset });
    res.json({ data: out.data, requestId: req.id });
  } catch (err) { next(err); }
});

router.get('/:id/config', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try { res.json({ data: await service().getConfig(req.params.id), requestId: req.id }); } catch (err) { next(err); }
});

router.get('/:id/audit', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const out = await service().listAudit(req.params.id, { limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined });
    res.json({ data: out.data, requestId: req.id });
  } catch (err) { next(err); }
});

// ── Sichere Aktionen: correlator-skopierter Config-Lifecycle (KEIN Apply) ─────
// Erzwingt zuerst capability ∈ correlator.configCapabilityIds, delegiert dann an
// den ConfigRegistryService (Validierung, Redaction, Vier-Augen, Audit).
router.post('/:id/drafts', requireAuth, requireRole('engineer', 'admin'), validate(correlatorCreateDraftSchema), async (req, res, next) => {
  try {
    const data = await service().createDraft(req.params.id, { capabilityId: req.body.capabilityId, value: req.body.value, actor: actorFrom(req) });
    res.status(201).json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

router.put('/:id/drafts/:draftId', requireAuth, requireRole('engineer', 'admin'), validate(updateDraftSchema), async (req, res, next) => {
  try {
    const data = await service().updateDraft(req.params.id, { draftId: req.params.draftId, value: req.body.value, expectedVersion: req.body.expectedVersion, actor: actorFrom(req) });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

router.post('/:id/drafts/:draftId/submit', requireAuth, requireRole('engineer', 'admin'), validate(submitSchema), async (req, res, next) => {
  try {
    const data = await service().submitDraft(req.params.id, { draftId: req.params.draftId, expectedVersion: req.body.expectedVersion, actor: actorFrom(req) });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// Freigabe/Ablehnung — admin-only. approved ≠ applied (kein Apply-Pfad).
router.post('/:id/drafts/:draftId/decision', requireAuth, requireRole('admin'), validate(decisionSchema), async (req, res, next) => {
  try {
    const data = await service().decideDraft(req.params.id, { draftId: req.params.draftId, decision: req.body.decision, expectedVersion: req.body.expectedVersion, note: req.body.note, actor: actorFrom(req) });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// ── P_CORR_ADMIN_2 Stufe 1: separate Validierung + Apply-Plan-Vorschau (KEIN Apply) ──
// Validieren ist ein expliziter Schritt im Engineer-Flow; der Plan ist eine read-only
// Vorschau (analyst+). Es wird NICHTS angewendet — applyStatus bleibt not_supported.
router.post('/:id/drafts/:draftId/validate', requireAuth, requireRole('engineer', 'admin'), async (req, res, next) => {
  try {
    const data = await service().validateDraft(req.params.id, { draftId: req.params.draftId });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

router.get('/:id/drafts/:draftId/plan', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const data = await service().getApplyPlan(req.params.id, { draftId: req.params.draftId });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// ── P_CORR_ADMIN_2 Stufe 2: kontrollierter Apply-Kanal (admin, gated, KEIN OS/Shell) ──
// Einfrieren des genehmigten Drafts zu einem immutablen Apply-Plan (admin).
router.post('/:id/drafts/:draftId/plan/freeze', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = await applyService().freezePlan(req.params.id, req.params.draftId, actorFrom(req));
    res.status(201).json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// Apply eines eingefrorenen Plans — admin + frische Reauth (X-Reauth-Token) + alle Gates.
// Bei Erfolg: applied. Bei Fehler: rolled_back bzw. failed_safe_stop (kein 5xx-Crash,
// der terminale Run-Status trägt das Ergebnis). Gate-Denial → 403, Konflikt → 409.
router.post('/:id/plans/:planId/apply', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const actor = { id: req.user?.sub, label: req.user?.email || req.user?.sub || '', role: req.user?.role };
    const data = await applyService().apply(req.params.id, req.params.planId, { actor, reauthToken: req.get('X-Reauth-Token') });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

router.get('/:id/apply-runs/:runId', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try { res.json({ data: await applyService().getRun(req.params.runId), requestId: req.id }); } catch (err) { next(err); }
});

router.get('/:id/apply-audit', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const data = await applyService().listAudit({ planId: req.query.planId, runId: req.query.runId });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// Read-only Live-Health des Correlation-Workers (Stufe 3) — ehrliche Anzeige.
router.get('/:id/worker-health', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try { res.json({ data: await applyService().getWorkerHealth(req.params.id), requestId: req.id }); } catch (err) { next(err); }
});

module.exports = router;
