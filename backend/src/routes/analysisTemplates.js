'use strict';

// Analyse-Vorlagen — geteilte Vorlagen-Bibliothek (CRUD).
// Aus dem Ursprungs-Tool portiert (war pro-Browser localStorage `soc_analyse_vtpl`),
// jetzt Backend-persistent und über alle Analysten geteilt.
const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { analysisTemplateService }  = require('../services/analysisTemplateServiceInstance');

const router = Router();

// GET /api/v1/analysis-templates — alle Vorlagen (neueste zuerst)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const templates = await analysisTemplateService.list();
    res.json({ data: templates.map((t) => t.toJSON()), total: templates.length, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /api/v1/analysis-templates/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const template = await analysisTemplateService.get(req.params.id);
    res.json({ data: template.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/analysis-templates — neue Vorlage (analyst+)
router.post('/', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const { name, desc, iocs, logs, actions, rec, notes } = req.body || {};
    const template = await analysisTemplateService.create({
      name, desc, iocs, logs, actions, rec, notes, author: req.user?.email || '',
    });
    res.status(201).json({ data: template.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT /api/v1/analysis-templates/:id — Vorlage aktualisieren (analyst+)
router.put('/:id', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const template = await analysisTemplateService.update(req.params.id, req.body || {});
    res.json({ data: template.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

// DELETE /api/v1/analysis-templates/:id — Vorlage löschen (analyst+)
router.delete('/:id', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    await analysisTemplateService.remove(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
