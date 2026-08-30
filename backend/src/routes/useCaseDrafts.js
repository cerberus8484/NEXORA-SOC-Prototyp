'use strict';

/**
 * useCaseDrafts-Router — KI Use-Case Developer (/v1/use-case-drafts).
 * (Getrennt von der bestehenden Use-Case-Bibliothek /v1/use-cases.)
 *
 * RBAC (Analyst→Engineer/Admin-Workflow, human-in-the-loop):
 *   - generate / review : analyst+ (erzeugen, zur Prüfung geben)
 *   - approve / reject  : engineer+ (Vier-Augen — Engineer/Admin entscheidet)
 *   - publish / delete  : admin
 *   - list / get        : authentifiziert (lesen)
 * KEINE Regel-Aktivierung, kein Wazuh-Write, kein Auto-Publish.
 */
const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { useCaseDeveloperService }  = require('../services/useCaseDeveloperInstance');
const { exportDraft, formatLanguage, VALID_FORMATS } = require('../services/RuleExporter');

const router = Router();
const actor = (req) => ({ id: req.user?.sub || null, role: req.user?.role || '', label: req.user?.email || '' });

// POST /generate { sourceType, sourceId } — Draft aus SOC-Quelle erzeugen (analyst+)
router.post('/generate', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const { sourceType, sourceId } = req.body || {};
    const r = await useCaseDeveloperService.generate({ sourceType, sourceId, actor: actor(req) });
    res.status(201).json({ success: true, data: r.draft, quality: r.quality, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /?status=&limit=&offset= — Liste (paginiert)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status = '', limit = 50, offset = 0 } = req.query;
    const r = await useCaseDeveloperService.list({ status, limit: Number(limit) || 50, offset: Number(offset) || 0 });
    res.json({ success: true, data: r.data, total: r.total, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const d = await useCaseDeveloperService.get(req.params.id);
    if (!d) return res.status(404).json({ error: 'not_found', requestId: req.id });
    res.json({ success: true, data: d, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /:id/quality — Quality-Gate (re-)bewerten
router.get('/:id/quality', requireAuth, async (req, res, next) => {
  try {
    const q = await useCaseDeveloperService.quality(req.params.id);
    res.json({ success: true, quality: q, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /:id/export?format=wazuh|sigma|splunk|qradar — textuelle Vorschau (requireAuth)
// KEIN Schreiben, KEIN Aktivieren — reine Transformation.
router.get('/:id/export', requireAuth, async (req, res, next) => {
  try {
    const format = String(req.query.format || '').toLowerCase().trim();

    // 400 bei fehlendem oder unbekanntem Format (vor dem DB-Lookup, fail-fast)
    if (!format || !VALID_FORMATS.has(format)) {
      return res.status(400).json({
        error:     'VALIDATION_ERROR',
        message:   `Ungültiges oder fehlendes format. Erlaubt: ${[...VALID_FORMATS].join(', ')}`,
        requestId: req.id,
      });
    }

    const draft = await useCaseDeveloperService.get(req.params.id);
    if (!draft) {
      return res.status(404).json({ error: 'not_found', requestId: req.id });
    }

    const content = exportDraft(draft, format);
    const language = formatLanguage(format);

    res.json({
      data: { format, language, content },
      requestId: req.id,
    });
  } catch (err) { next(err); }
});

// Status-Übergänge (Domain validiert → 409 bei ungültig)
function transition(method, ...roles) {
  return [requireAuth, requireRole(...roles), async (req, res, next) => {
    try {
      const updated = await useCaseDeveloperService[method](req.params.id, actor(req));
      res.json({ success: true, data: updated, requestId: req.id });
    } catch (err) { next(err); }
  }];
}

router.post('/:id/review',  ...transition('sendToReview', 'analyst'));
router.post('/:id/approve', ...transition('approve', 'engineer'));
router.post('/:id/reject',  ...transition('reject', 'engineer'));
router.post('/:id/publish', ...transition('publish', 'admin'));

module.exports = router;
