'use strict';

// YARA Engine — Regel-CRUD + Scan-Endpoint.
const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { yaraService }              = require('../services/yaraServiceInstance');

const router = Router();

// GET /api/v1/yara  — alle Regeln (mit optionalem ?tag=&enabledOnly=true)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rules = await yaraService.listRules({
      enabledOnly: req.query.enabledOnly === 'true',
      tag: req.query.tag || undefined,
    });
    res.json({ data: rules.map((r) => r.toJSON()), total: rules.length, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /api/v1/yara/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const rule = await yaraService.getRule(req.params.id);
    res.json({ data: rule.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/yara  — neue Regel (analyst+admin)
router.post('/', requireAuth, requireRole('analyst', 'admin'), async (req, res, next) => {
  try {
    const { name, description, tags, patterns, condition, author, severity, mitreAttack } = req.body || {};
    const rule = await yaraService.createRule({ name, description, tags, patterns, condition, author, severity, mitreAttack });
    res.status(201).json({ data: rule.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT /api/v1/yara/:id  — Regel aktualisieren (analyst+admin)
router.put('/:id', requireAuth, requireRole('analyst', 'admin'), async (req, res, next) => {
  try {
    const rule = await yaraService.updateRule(req.params.id, req.body || {});
    res.json({ data: rule.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

// DELETE /api/v1/yara/:id  — Regel löschen (admin only)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    await yaraService.deleteRule(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/v1/yara/scan  — Input gegen alle aktiven Regeln scannen
const MAX_SCAN_INPUT = 1_000_000; // 1 MB
router.post('/scan', requireAuth, async (req, res, next) => {
  try {
    const { input, tag } = req.body || {};
    if (!input || input.length > MAX_SCAN_INPUT) {
      return res.status(400).json({ error: 'input fehlt oder zu groß (max 1 MB)', requestId: req.id });
    }
    const result = await yaraService.scan(input, { tag });
    res.json({ data: result, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
