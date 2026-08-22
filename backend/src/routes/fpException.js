'use strict';

// FP-Exception-Router — alle Routen unter /api/v1/tickets/:id/fp-exception
// Extrahiert aus tickets.js (SRP: Ticket-Router trägt keine FP-Wazuh-Logik).
// Eingehängt via Router({ mergeParams: true }) → :id aus dem Parent-Router verfügbar.

const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { ticketService }            = require('../services/TicketService');
const { normalizeWazuhEvidence }   = require('../integrations/adapters/wazuh/wazuhEvidenceNormalizer');
const { buildFpException, scopeFromEvidence, recommendExceptionTarget } = require('../integrations/adapters/wazuh/wazuhRuleExceptionBuilder');
const { wazuhFpExceptionService }  = require('../services/wazuhFpExceptionInstance');
const { wazuhApiClient }           = require('../integrations/adapters/wazuh/wazuhApiInstance');

const router = Router({ mergeParams: true });

const fpActor = (req) => ({ id: req.user?.id || null, role: req.user?.role || '', label: req.user?.email || req.user?.displayName || '' });
const fpStatus = (result) => {
  if (result.ok) return 200;
  if (result.disabled) return 403;                                  // Safety-Gate (WAZUH_FP_APPLY_ENABLED!=true)
  if (result.errors?.some((e) => /nicht gefunden/.test(e))) return 404;
  return 422;
};

// ── GET .../fp-exception/suggest — vorbefüllter Scope aus Evidence (kein Write) ──
router.get('/suggest', requireAuth, async (req, res, next) => {
  try {
    const ticket = await ticketService.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found', requestId: req.id });
    const evidence = ticket.source === 'wazuh' ? normalizeWazuhEvidence(ticket) : null;
    const scope = evidence ? scopeFromEvidence(evidence, ticket) : null;
    // Frequency-Regel? → Empfehlung, die Ausnahme auf die Basis-Regel zu legen
    // (best-effort; ohne Wazuh-API bleibt ruleTarget null).
    let ruleTarget = null;
    try {
      if (scope?.ruleId && wazuhApiClient.isEnabled()) {
        ruleTarget = recommendExceptionTarget(await wazuhApiClient.getRuleDetail(scope.ruleId));
      }
    } catch { /* Targeting-Empfehlung optional */ }
    res.json({ data: scope, ruleTarget, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST .../fp-exception/preview — XML-Vorschau (KEIN Write) ──
router.post('/preview', requireAuth, async (req, res, next) => {
  try {
    const result = buildFpException({ ...(req.body || {}), ticketId: req.body?.ticketId || req.params.id });
    res.json({ ...result, applied: false, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET .../fp-exception — Exceptions am Ticket (auth) ──
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const data = await wazuhFpExceptionService.getForTicket(req.params.id);
    res.json({ data, capabilities: wazuhFpExceptionService.capabilities(), requestId: req.id });
  } catch (err) { next(err); }
});

// ── POST .../fp-exception/forward — Analyst erstellt + leitet weiter (KEIN Write, analyst+) ──
router.post('/forward', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    const result = await wazuhFpExceptionService.forward({ ticketId: req.params.id, scope: req.body || {}, actor: fpActor(req) });
    res.status(fpStatus(result)).json({ ...result, requestId: req.id });
  } catch (err) { next(err); }
});

// ── POST .../fp-exception/quick — rollenabhängiger Ein-Klick aus dem Ticket (analyst+) ──
// Baut den Scope automatisch aus der Ticket-Evidence (wie /suggest); Body darf
// Felder ergänzen/überschreiben (mind. reason). Delegiert rollenabhängig an
// forward (Analyst / Gate aus) bzw. apply (Engineer/Admin bei scharfem Gate).
router.post('/quick', requireAuth, requireRole('analyst'), async (req, res, next) => {
  try {
    let base = {};
    try {
      const ticket = await ticketService.findById(req.params.id);
      if (ticket && ticket.source === 'wazuh') {
        const evidence = normalizeWazuhEvidence(ticket);
        if (evidence) base = scopeFromEvidence(evidence, ticket);
      }
    } catch { /* Evidence-Vorbefüllung optional — Scope kann komplett aus dem Body kommen */ }
    const scope = { ...base, ...(req.body || {}) };
    const result = await wazuhFpExceptionService.quick({ ticketId: req.params.id, scope, actor: fpActor(req) });
    res.status(fpStatus(result)).json({ ...result, requestId: req.id });
  } catch (err) { next(err); }
});

// ── POST .../fp-exception/apply — schreibt Rule-Datei + validiert, KEIN Restart (engineer+) ──
router.post('/apply', requireAuth, requireRole('engineer'), async (req, res, next) => {
  try {
    const result = await wazuhFpExceptionService.apply({ ticketId: req.params.id, scope: req.body || {}, actor: fpActor(req) });
    res.status(fpStatus(result)).json({ ...result, requestId: req.id });
  } catch (err) { next(err); }
});

// ── POST .../fp-exception/restart — expliziter Manager-Restart (admin) ──
router.post('/restart', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await wazuhFpExceptionService.restart({ exceptionId: req.body?.exceptionId, actor: fpActor(req) });
    res.status(fpStatus(result)).json({ ...result, requestId: req.id });
  } catch (err) { next(err); }
});

// ── POST .../fp-exception/revert — Regel entfernen (admin) ──
router.post('/revert', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const result = await wazuhFpExceptionService.revert({ exceptionId: req.body?.exceptionId, actor: fpActor(req) });
    res.status(fpStatus(result)).json({ ...result, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
