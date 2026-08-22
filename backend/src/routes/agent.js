'use strict';

// KI-Agent — Suggestions + Human-Approval-Workflow (P19 Alpha).
const { Router }                   = require('express');
const rateLimit                    = require('express-rate-limit');
const { ipKeyGenerator }           = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { agentService }             = require('../services/agentServiceInstance');
const { ticketService }            = require('../services/TicketService');
const { evidenceService }          = require('../services/EvidenceService');
const { describeGuardrails }       = require('../agents/guardrailConfig');
const { agentMetrics }             = require('../services/AgentMetrics');
const { decorateWithRouting }      = require('../domain/mlRoutingPolicy');
const { getActiveRoutingPolicy }   = require('../services/routingPolicyInstance');

const router = Router();

// ─── Rate-Limit auf /propose ──────────────────────────────────────────────────
// /propose stößt einen teuren LLM-Call an — ohne Limit könnte ein kompromittiertes
// Konto (oder eine Schleife im Client) das KI-Backend fluten. Gleiches Muster wie
// die Provisioning-Limiter: 429 ohne Secret-Spiegelung, im Test default-inaktiv
// (fail-secure in Prod: NIE übersprungen). Schlüssel = User-sub (authentifiziert,
// NAT-transparent), Fallback IP.
const PROPOSE_WINDOW_MS = 60_000;
const PROPOSE_MAX_DEFAULT = 30; // moderat: ~1 Vorschlag / 2 s je User
const proposeTooMany = (req, res) => res.status(429).json({
  error: 'TOO_MANY_REQUESTS',
  message: 'Zu viele KI-Vorschlags-Anfragen — bitte kurz warten.',
  requestId: req.id,
});
const proposeRateLimiter = rateLimit({
  windowMs: PROPOSE_WINDOW_MS,
  max:      Number.parseInt(process.env.AGENT_PROPOSE_MAX || `${PROPOSE_MAX_DEFAULT}`, 10),
  standardHeaders: true,
  legacyHeaders:   false,
  // /propose läuft immer hinter requireAuth → req.user.sub ist gesetzt (NAT-transparent).
  // Fallback auf die IP via ipKeyGenerator (IPv6-sicher, vom Limiter gefordert).
  keyGenerator: (req) => req.user?.sub || ipKeyGenerator(req.ip),
  // In Prod immer aktiv; im Test nur wenn AGENT_PROPOSE_MAX explizit gesetzt ist
  // (sonst stört es die bestehende Suite nicht).
  skip: () => process.env.NODE_ENV === 'test' && !process.env.AGENT_PROPOSE_MAX,
  handler: proposeTooMany,
});

// Hängt — falls eine ML-Routing-Policy aktiv ist (ML_ROUTING_POLICY_PATH) — eine
// advisory Routing-Empfehlung (auto-accept-eligible vs route-to-review) an die
// serialisierte Suggestion. Fail-safe: ohne aktive Policy unverändert.
const withRouting = (json) => decorateWithRouting(json, getActiveRoutingPolicy());

// GET /api/v1/agent/guardrails — read-only Transparenz der aktiven Safety-Floors (alle Rollen)
router.get('/guardrails', requireAuth, (req, res) => {
  res.json({ data: describeGuardrails(), requestId: req.id });
});

// GET /api/v1/agent/metrics — KI-Nutzungs-/Latenz-Metriken seit Boot (engineer+admin)
router.get('/metrics', requireAuth, requireRole('engineer', 'admin'), (req, res) => {
  res.json({ data: agentMetrics.snapshot(), requestId: req.id });
});

// GET /api/v1/agent/suggestions  — Liste (?status=&ticketId=)
router.get('/suggestions', requireAuth, async (req, res, next) => {
  try {
    const items = await agentService.listSuggestions({
      status:   req.query.status   || undefined,
      ticketId: req.query.ticketId || undefined,
    });
    res.json({ data: items.map((s) => withRouting(s.toJSON())), total: items.length, requestId: req.id });
  } catch (err) { next(err); }
});

// GET /api/v1/agent/suggestions/:id
router.get('/suggestions/:id', requireAuth, async (req, res, next) => {
  try {
    const s = await agentService.getSuggestion(req.params.id);
    res.json({ data: withRouting(s.toJSON()), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/agent/propose  { ticketId, kind } — Agent erzeugt Vorschlag (analyst+admin)
// Rate-Limit NACH requireAuth (keyGenerator nutzt req.user.sub), VOR der teuren Logik.
router.post('/propose', requireAuth, proposeRateLimiter, requireRole('analyst', 'admin'), async (req, res, next) => {
  try {
    const { ticketId, kind, note } = req.body || {};
    if (!ticketId) return res.status(400).json({ error: 'ticketId erforderlich', requestId: req.id });
    // Optionaler Analyst-Hinweis (Re-Propose mit Kontext) — gecappt gegen Prompt-Bloat.
    const analystNote = typeof note === 'string' ? note.slice(0, 2000) : '';
    const ticket = await ticketService.findById(ticketId); // wirft NotFoundError
    const evidence = await evidenceService.findByTicket(ticketId).catch(() => []);
    const s = await agentService.propose({ ticket, kind, evidence, note: analystNote });
    res.status(201).json({ data: withRouting(s.toJSON()), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/agent/suggestions/:id/approve  (analyst+admin)
router.post('/suggestions/:id/approve', requireAuth, requireRole('analyst', 'admin'), async (req, res, next) => {
  try {
    const s = await agentService.approve(req.params.id, req.user?.sub, req.user?.email || '');
    res.json({ data: s.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/agent/suggestions/:id/reject  { reason }  (analyst+admin)
router.post('/suggestions/:id/reject', requireAuth, requireRole('analyst', 'admin'), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    const s = await agentService.reject(req.params.id, req.user?.sub, reason || '', req.user?.email || '');
    res.json({ data: s.toJSON(), requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
