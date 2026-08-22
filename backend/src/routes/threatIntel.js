'use strict';

// Threat-Intel-Enrichment (P17.1, Mock-first). Read-only, requireAuth.
// Keine echten Provider-Calls/Keys in P17.1. Enrichment ist Kontext, kein Auto-Verdict.

const { Router }      = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { threatIntelService } = require('../integrations/threatIntel/threatIntelInstance');

const router = Router();

// POST /api/v1/threat-intel/enrich  Body: { indicatorType, indicatorValue }
router.post('/enrich', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const { indicatorType, indicatorValue } = req.body || {};
    const r = await threatIntelService.enrich({ indicatorType, indicatorValue });
    if (!r.ok) return res.status(400).json({ error: r.error, requestId: req.id });
    res.json({ data: r.result, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
