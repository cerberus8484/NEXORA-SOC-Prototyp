'use strict';

// System-/DB-Status fuer die native Status-Seite (aggregierte DB-Kennzahlen)
// plus fail-closed System-Ops (admin-only, frische Reauth).
const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { systemStatsService } = require('../services/systemStatsInstance');
const { systemControlService } = require('../services/systemControlServiceInstance');

const router = Router();

// GET /api/v1/system/stats — DB-Counts (Tickets/Evidence/Hunts/Audit/FP/User)
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const data = await systemStatsService.getStats();
    res.json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /api/v1/system/control — admin-only Sicht auf verfuegbare Restart-/Update-Aktionen.
router.get('/control', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: { actions: systemControlService.listActions() }, requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/system/control/:actionId — admin-only + frische deploy_reauth.
router.post('/control/:actionId', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = await systemControlService.triggerAction(req.params.actionId, {
      actor: { id: req.user?.sub ?? null, role: req.user?.role ?? null, label: req.user?.email ?? 'unknown' },
      reauthToken: req.get('X-Reauth-Token'),
      ip: req.ip || '',
    });
    res.status(202).json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
