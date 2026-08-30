'use strict';

// Audit-Log (read-only Activity-Feed). Append-only — kein Schreibzugriff über diese Route.
const { Router }      = require('express');
const validate        = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { auditQuerySchema, auditExportSchema } = require('../domain/validation/auditSchema');

const router = Router();

// A6c: Obergrenze pro Export (Operator-konfigurierbar, Default 5000). Wird die Gesamtmenge
// überschritten, meldet die Antwort `truncated:true` (kein still gekürzter forensischer Export).
const AUDIT_EXPORT_MAX = Number(process.env.AUDIT_EXPORT_MAX) || 5000;

// GET /api/v1/audit?limit=&offset=&action=&targetType=&targetId=&search=
// Gibt { data, total, limit, offset, page, pageSize, hasNext, hasPrevious, requestId } zurück.
router.get('/', requireAuth, requireRole('analyst'), validate(auditQuerySchema, 'query'), async (req, res, next) => {
  try {
    const q = req.validatedQuery;
    const result = await auditService.findRecent({
      limit:      q.limit,
      offset:     q.offset,
      action:     q.action,
      targetType: q.targetType,
      targetId:   q.targetId,
      search:     q.search,
    });
    // A6a: explizite Pagination-Metadaten aus dem exakten serverseitigen total.
    const pageSize    = result.limit;
    const page        = Math.floor(result.offset / pageSize) + 1;
    const hasNext     = result.offset + result.limit < result.total;
    const hasPrevious = result.offset > 0;
    res.json({ ...result, page, pageSize, hasNext, hasPrevious, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/audit/export — bewusster, auditierter Export (CSV/PDF baut der Client aus data).
// A6c: gedeckelt auf AUDIT_EXPORT_MAX; `truncated` macht eine Kürzung sichtbar; der Export
// selbst wird auditiert (WER hat WANN WIE VIELE Audit-Einträge mit welchen Filtern exportiert).
router.post('/export', requireAuth, requireRole('analyst'), validate(auditExportSchema), async (req, res, next) => {
  try {
    const q = req.body;
    const result = await auditService.findRecent({
      limit:      AUDIT_EXPORT_MAX,
      offset:     0,
      action:     q.action,
      targetType: q.targetType,
      targetId:   q.targetId,
      search:     q.search,
    });
    const returned  = result.data.length;
    const truncated = result.total > returned;
    const actor     = req.user?.email || req.user?.sub || '';

    // Audit: nur sichere Metadaten — Filter-Präsenz, KEIN Suchbegriff/keine PII.
    await auditService.write({
      actorUserId: req.user?.sub, actorLabel: actor, action: AUDIT_ACTIONS.AUDIT_EXPORT,
      targetType: 'audit_log', targetId: '', ip: req.ip,
      metadata: {
        format: q.format, returned, total: result.total, truncated, exportLimit: AUDIT_EXPORT_MAX,
        filters: {
          action: q.action || null, targetType: q.targetType || null,
          targetId: q.targetId || null, search: Boolean(q.search),
        },
      },
    });

    res.json({ data: result.data, total: result.total, returned, truncated, exportLimit: AUDIT_EXPORT_MAX, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
