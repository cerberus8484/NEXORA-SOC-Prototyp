'use strict';

const { Router } = require('express');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { mlEvalExportService } = require('../services/mlEvalExportInstance');
const { mlEvalExportSchema } = require('../domain/validation/mlEvalSchema');
const { getActiveRoutingPolicy } = require('../services/routingPolicyInstance');

function createMlEvalRouter({ service = mlEvalExportService, audit = auditService } = {}) {
  const router = Router();

  // GET /api/v1/ml/eval/status — read-only Übersicht für die ML-Eval-Admin-Seite.
  // Zeigt, ob eine Routing-Policy aktiv ist (ohne den Dateipfad zu leaken).
  router.get('/status', requireAuth, requireRole('admin'), (req, res) => {
    const policy = getActiveRoutingPolicy();
    const routingPolicy = policy.active
      ? { active: true, policyName: policy.policyName, threshold: policy.threshold }
      : { active: false, reason: policy.reason || 'unset' };
    res.json({ data: { routingPolicy }, requestId: req.id });
  });

  router.post('/export', requireAuth, requireRole('admin'), validate(mlEvalExportSchema), async (req, res, next) => {
    try {
      const q = req.body;
      const actor = req.user?.email || req.user?.sub || '';
      const snapshot = q.format === 'jsonl'
        ? await service.buildJsonl(q)
        : await service.buildSnapshot(q);

      if (audit) {
        await audit.write({
          actorUserId: req.user?.sub,
          actorLabel: actor,
          action: AUDIT_ACTIONS.ML_EVAL_EXPORT,
          targetType: 'ml_eval_snapshot',
          targetId: '',
          ip: req.ip,
          metadata: {
            format: q.format,
            include: q.include,
            returned: snapshot.returned,
            counts: snapshot.counts,
            exportLimit: snapshot.exportLimit,
            recordSha256: snapshot.recordSha256,
          },
        });
      }

      if (q.format === 'jsonl') {
        res.set('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.set('X-Nexora-ML-Eval-Schema', snapshot.schemaVersion);
        res.set('X-Nexora-ML-Eval-Records', String(snapshot.returned));
        res.set('X-Nexora-ML-Eval-Sha256', snapshot.recordSha256);
        res.set('X-Nexora-ML-Eval-Generated-At', snapshot.generatedAt);
        return res.status(200).send(snapshot.body);
      }

      return res.json({ data: snapshot.records, meta: {
        schemaVersion: snapshot.schemaVersion,
        generatedAt: snapshot.generatedAt,
        recordSha256: snapshot.recordSha256,
        returned: snapshot.returned,
        counts: snapshot.counts,
        labelSourceCounts: snapshot.labelSourceCounts,
        humanLabelCounts: snapshot.humanLabelCounts,
        exportLimit: snapshot.exportLimit,
        include: snapshot.include,
      }, requestId: req.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createMlEvalRouter();
module.exports.createMlEvalRouter = createMlEvalRouter;
