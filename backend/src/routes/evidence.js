'use strict';

// Evidence-Store (Chain of Custody). Append-only — kein PUT/DELETE.
const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { evidenceService }          = require('../services/EvidenceService');
const { auditService }             = require('../services/AuditService');
const { correlationMutationService } = require('../correlation/CorrelationMutationService');

const router = Router();

// GET /api/v1/evidence?ticketId=...  (ohne ticketId → letzte N global)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const data = req.query.ticketId
      ? await evidenceService.findByTicket(req.query.ticketId)
      : await evidenceService.findAll({ limit: Number(req.query.limit) || 200 });
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/evidence/export  — Evidence-Paket ERZEUGEN (bewusste Export-Aktion).
// A4b: Der Export protokolliert Custody + Audit (forensischer Status) → bewusst POST,
// NICHT GET (ein GET darf keinen dauerhaften forensischen Zustand erzeugen). Body { ticketId }.
router.post('/export', requireAuth, async (req, res, next) => {
  try {
    const ticketId = req.body?.ticketId;
    if (!ticketId) return res.status(400).json({ error: 'ticketId erforderlich', requestId: req.id });
    const actor = req.user?.email || req.user?.sub || '';
    const pkg = await evidenceService.exportForTicket(ticketId, { actor });
    // Audit: WER hat WANN WIE VIELE Evidence-Items exportiert (Compliance/Forensik, Art. 32).
    await auditService.write({
      actorUserId: req.user?.sub, actorLabel: actor, action: 'evidence.export',
      targetType: 'ticket', targetId: String(ticketId), ip: req.ip,
      metadata: { count: pkg.count, integrityOk: pkg.integrityOk },
    });
    res.json({ data: pkg, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /api/v1/evidence/:id  — Item + Chain-of-Custody-Log + Review-Status
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const e = await evidenceService.detail(req.params.id);
    if (!e) return res.status(404).json({ error: 'not_found', requestId: req.id });
    res.json({ data: e, requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/evidence/:id/custody  (analyst + admin) — Review/Verify/Flag protokollieren
router.post('/:id/custody', requireAuth, requireRole('analyst', 'admin'), async (req, res, next) => {
  try {
    const actor = req.user?.email || req.user?.sub || '';
    const r = await evidenceService.addCustody({ evidenceId: req.params.id, action: req.body?.action, note: req.body?.note || '', actor });
    if (!r.ok) return res.status(404).json({ error: r.error, requestId: req.id });
    await auditService.write({
      actorUserId: req.user?.sub, actorLabel: actor, action: 'evidence.custody',
      targetType: 'evidence', targetId: req.params.id, ip: req.ip, metadata: { custodyAction: r.event.action },
    });
    const detail = await evidenceService.detail(req.params.id);
    res.status(201).json({ data: detail, requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/evidence  (analyst + admin) — neues Evidence-Item
router.post('/', requireAuth, requireRole('analyst', 'admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const r = await correlationMutationService.addEvidence({ ...b, collectedBy: req.user?.email || req.user?.sub || '' });
    if (!r.ok) return res.status(400).json({ error: r.error, requestId: req.id });
    await auditService.write({
      actorUserId: req.user?.sub,
      actorLabel:  req.user?.email || 'unknown',
      action:      'evidence.create',
      targetType:  'evidence',
      targetId:    r.evidence.id,
      ip:          req.ip,
      metadata:    { ticketId: r.evidence.ticketId, type: r.evidence.type, source: r.evidence.source },
    });
    res.status(201).json({ data: r.evidence, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
