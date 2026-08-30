'use strict';

// Use-Case-Bibliothek — geteilte Liste von Use-Case-Labels (CRUD ohne Update).
// Aus dem Ursprungs-Tool portiert (war pro-Browser localStorage `soc_usecases`).
const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { useCaseService }           = require('../services/useCaseServiceInstance');

const router = Router();

// GET /api/v1/use-cases — alle (alphabetisch)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const items = await useCaseService.list();
    res.json({ data: items.map((u) => u.toJSON()), total: items.length, requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/use-cases — neuen Use-Case (analyst+)
router.post('/', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const { value } = req.body || {};
    const uc = await useCaseService.create({ value, author: req.user?.email || '' });
    res.status(201).json({ data: uc.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

// DELETE /api/v1/use-cases/:id — entfernen (analyst+)
router.delete('/:id', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    await useCaseService.remove(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
