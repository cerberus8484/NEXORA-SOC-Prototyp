'use strict';

/**
 * Hunts-Router — P13.2
 *
 * Route ist reiner HTTP-Layer:
 *   - Auth + RBAC via Middleware
 *   - Validierung via validate()
 *   - Business Logic → HuntService
 *   - Audit → HuntService (nicht direkt in Route)
 *
 * RBAC (implementiert + fixiert in tests/api/hunts.test.js):
 *   viewer  → GET (lesen)
 *   analyst → create, notes, commands, artifacts, findings, start, complete
 *             HINWEIS: KEINE Ownership-Prüfung — diese Aktionen wirken auf JEDE
 *             Session, nicht nur auf selbst angelegte (Service erzwingt keinen Owner).
 *   admin   → cancel + fail (terminale/destruktive Lifecycle-Aktionen, bewusst admin-only)
 *
 * Folge fürs Frontend: ein Cancel-/Fail-Button gehört an einen ADMIN-Gate,
 * NICHT an `canAct` (analyst+) — sonst 403. huntApi.cancel ist admin-only.
 */

const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const validate                     = require('../middleware/validate');
const { huntService }              = require('../threatHunting/services/huntServiceInstance');
const { getCatalog }               = require('../threatHunting/domain/HuntType');
const {
  createSessionSchema,
  failSessionSchema,
  addNoteSchema,
  listSessionsSchema,
  createCommandSchema,
  completeCommandSchema,
  failCommandSchema,
  blockCommandSchema,
  createArtifactSchema,
  createFindingSchema,
  linkTicketSchema,
  setFindingVerdictSchema,
}                                  = require('../threatHunting/domain/huntSchema');

const router = Router();

// ── GET /v1/hunts ─────────────────────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  requireRole('viewer'),
  validate(listSessionsSchema, 'query'),
  async (req, res, next) => {
    try {
      const sessions = await huntService.listSessions(req.validatedQuery || req.query);
      res.json({ data: sessions, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts ────────────────────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  requireRole('analyst'),
  validate(createSessionSchema),
  async (req, res, next) => {
    try {
      const session = await huntService.createSession({
        ...req.body,
        analystId: req.user.sub,
      });
      res.status(201).json({ data: session.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── GET /v1/hunts/catalog ─────────────────────────────────────────────────────
// Vorgefertigte Hunts (Metadaten) für den One-Click-Katalog. Vor /:id!
router.get(
  '/catalog',
  requireAuth,
  requireRole('viewer'),
  (req, res) => {
    res.json({ data: getCatalog(), requestId: req.id });
  },
);

// ── Containment-Circuit-Breaker (ADR-042) ─────────────────────────────────────
// VOR den `/:id`-Routen registriert, damit `/response-circuit` nicht als Session-ID
// interpretiert wird. Status = viewer (Anzeige), Reset = admin (nach Review).
// GET /v1/hunts/response-circuit → { open, failStreak, threshold }
router.get(
  '/response-circuit',
  requireAuth,
  requireRole('viewer'),
  (req, res) => {
    res.json({ data: huntService.getResponseCircuit(), requestId: req.id });
  },
);
// POST /v1/hunts/response-circuit/reset (admin) → entsperrt den Containment-Kanal.
router.post(
  '/response-circuit/reset',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const result = await huntService.resetResponseCircuit({ actor: { id: req.user.sub } });
      res.json({ data: result, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── GET /v1/hunts/:id ─────────────────────────────────────────────────────────
router.get(
  '/:id',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const session = await huntService.getSession(req.params.id);
      res.json({ data: session.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/start ──────────────────────────────────────────────────
router.post(
  '/:id/start',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      // Asynchroner Runner: Session kommt sofort als 'active' zurück, Logs/Findings
      // erscheinen zeitversetzt → Frontend-Polling zeigt echtes "Running".
      const session = await huntService.startHunt(req.params.id, req.user.sub, { stepDelayMs: 700 });
      res.json({ data: session.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── GET /v1/hunts/:id/logs ────────────────────────────────────────────────────
router.get(
  '/:id/logs',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const logs = await huntService.getLogs(req.params.id);
      res.json({ data: logs, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/pause ──────────────────────────────────────────────────
// Pause ist im synchronen Runner-MVP nicht unterstützt — sauberer Hinweis.
router.post(
  '/:id/pause',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      await huntService.getSession(req.params.id); // 404-Guard
      res.status(501).json({
        error: 'NOT_SUPPORTED',
        message: 'Pause wird im synchronen Hunt-Runner-MVP nicht unterstützt (coming soon).',
        requestId: req.id,
      });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/run-command ────────────────────────────────────────────
// Safe Command Console (Stufe 1): nur Allowlist (read-only), kein Remote-Exec.
router.post(
  '/:id/run-command',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      const command = await huntService.runSafeCommand(req.params.id, req.body?.command, req.user.sub);
      res.status(201).json({ data: command.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── Response Actions: Approval-Gate + Host-Isolation (Stufe 2) ─────────────────
// Anfragen darf analyst+, genehmigen/ablehnen nur admin (Vier-Augen im Service).

// POST /v1/hunts/:id/response-actions  { kind, command?, reason? }
router.post(
  '/:id/response-actions',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      const { kind, command, reason } = req.body || {};
      const action = await huntService.requestResponseAction(req.params.id, { kind, command, reason }, req.user.sub);
      res.status(201).json({ data: action.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// GET /v1/hunts/:id/response-actions
router.get(
  '/:id/response-actions',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const items = await huntService.listResponseActions(req.params.id);
      res.json({ data: items, total: items.length, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// POST /v1/hunts/:id/response-actions/:actionId/approve  (admin, Vier-Augen)
router.post(
  '/:id/response-actions/:actionId/approve',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const { authorizationBasis } = req.body || {};
      const action = await huntService.approveResponseAction(req.params.id, req.params.actionId, req.user.sub, authorizationBasis);
      res.json({ data: action.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// POST /v1/hunts/:id/response-actions/:actionId/reject  { reason }  (admin)
router.post(
  '/:id/response-actions/:actionId/reject',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const action = await huntService.rejectResponseAction(req.params.id, req.params.actionId, req.user.sub, req.body?.reason || '');
      res.json({ data: action.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// POST /v1/hunts/:id/response-actions/:actionId/execute  (admin + frische Reauth)
// ECHTE, menschlich ausgelöste Ausführung genehmigter Containment-Aktionen (ADR-042, Stufe 3).
// Gated (HUNT_RESPONSE_REAL_EXEC_ENABLED, default AUS) + Drei-Parteien-Trennung + fail-closed
// im Service; X-Reauth-Token wie beim Deploy-Apply. NIE automatisch — ein Mensch löst aus.
router.post(
  '/:id/response-actions/:actionId/execute',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const action = await huntService.executeResponseAction(req.params.id, req.params.actionId, {
        actor: { id: req.user.sub },
        reauthToken: req.get('X-Reauth-Token'),
      });
      res.json({ data: action.toJSON(), requestId: req.id });
    } catch (err) {
      // Der Service wirft gated/fail-closed-Fehler mit {status, code} (redigierte Meldung,
      // nie Roh-Fehler/Secret) → direkt fürs UI zurückgeben; Unerwartetes an den Handler.
      if (err && err.status) {
        return res.status(err.status).json({ error: err.code || 'ERROR', message: err.message, requestId: req.id });
      }
      next(err);
    }
  },
);

// ── POST /v1/hunts/:id/complete ───────────────────────────────────────────────
router.post(
  '/:id/complete',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      const session = await huntService.completeSession(req.params.id, req.user.sub);
      res.json({ data: session.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/fail ───────────────────────────────────────────────────
router.post(
  '/:id/fail',
  requireAuth,
  requireRole('admin'),   // nur admin kann Session als gescheitert markieren
  validate(failSessionSchema),
  async (req, res, next) => {
    try {
      const session = await huntService.failSession(
        req.params.id,
        req.user.sub,
        req.body.reason || '',
      );
      res.json({ data: session.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/cancel ─────────────────────────────────────────────────
router.post(
  '/:id/cancel',
  requireAuth,
  requireRole('admin'),   // nur admin kann fremde Sessions abbrechen
  async (req, res, next) => {
    try {
      const session = await huntService.cancelSession(req.params.id, req.user.sub);
      res.json({ data: session.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/notes ──────────────────────────────────────────────────
router.post(
  '/:id/notes',
  requireAuth,
  requireRole('analyst'),
  validate(addNoteSchema),
  async (req, res, next) => {
    try {
      const note = await huntService.addNote(req.params.id, {
        content:   req.body.content,
        analystId: req.user.sub,
      });
      res.status(201).json({ data: note.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── GET /v1/hunts/:id/notes ───────────────────────────────────────────────────
router.get(
  '/:id/notes',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const notes = await huntService.getNotes(req.params.id);
      res.json({ data: notes, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/commands ───────────────────────────────────────────────
router.post(
  '/:id/commands',
  requireAuth,
  requireRole('analyst'),
  validate(createCommandSchema),
  async (req, res, next) => {
    try {
      const command = await huntService.addCommand(req.params.id, {
        ...req.body,
        analystId: req.user.sub,
      });
      res.status(201).json({ data: command.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── GET /v1/hunts/:id/commands ────────────────────────────────────────────────
router.get(
  '/:id/commands',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const commands = await huntService.getCommands(req.params.id);
      res.json({ data: commands, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── GET /v1/hunts/:id/commands/:commandId ─────────────────────────────────────
router.get(
  '/:id/commands/:commandId',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const command = await huntService.getCommand(req.params.id, req.params.commandId);
      res.json({ data: command.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/commands/:commandId/start ──────────────────────────────
router.post(
  '/:id/commands/:commandId/start',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      const command = await huntService.startCommand(req.params.id, req.params.commandId, req.user.sub);
      res.json({ data: command.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/commands/:commandId/complete ───────────────────────────
router.post(
  '/:id/commands/:commandId/complete',
  requireAuth,
  requireRole('analyst'),
  validate(completeCommandSchema),
  async (req, res, next) => {
    try {
      const command = await huntService.completeCommand(
        req.params.id, req.params.commandId, req.user.sub, req.body,
      );
      res.json({ data: command.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/commands/:commandId/fail ───────────────────────────────
router.post(
  '/:id/commands/:commandId/fail',
  requireAuth,
  requireRole('analyst'),
  validate(failCommandSchema),
  async (req, res, next) => {
    try {
      const command = await huntService.failCommand(
        req.params.id, req.params.commandId, req.user.sub, req.body,
      );
      res.json({ data: command.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/commands/:commandId/block ──────────────────────────────
router.post(
  '/:id/commands/:commandId/block',
  requireAuth,
  requireRole('admin'),   // nur admin kann blockieren
  validate(blockCommandSchema),
  async (req, res, next) => {
    try {
      const command = await huntService.blockCommand(
        req.params.id, req.params.commandId, req.user.sub, req.body.reason || '',
      );
      res.json({ data: command.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/commands/:commandId/requeue ────────────────────────────
router.post(
  '/:id/commands/:commandId/requeue',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      const command = await huntService.requeueCommand(
        req.params.id, req.params.commandId, req.user.sub,
      );
      res.json({ data: command.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/artifacts ──────────────────────────────────────────────
router.post(
  '/:id/artifacts',
  requireAuth,
  requireRole('analyst'),
  validate(createArtifactSchema),
  async (req, res, next) => {
    try {
      const artifact = await huntService.addArtifact(req.params.id, {
        ...req.body,
        analystId: req.user.sub,
      });
      res.status(201).json({ data: artifact.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── GET /v1/hunts/:id/artifacts ───────────────────────────────────────────────
router.get(
  '/:id/artifacts',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const artifacts = await huntService.getArtifacts(req.params.id);
      res.json({ data: artifacts, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── POST /v1/hunts/:id/findings ───────────────────────────────────────────────
router.post(
  '/:id/findings',
  requireAuth,
  requireRole('analyst'),
  validate(createFindingSchema),
  async (req, res, next) => {
    try {
      const finding = await huntService.addFinding(req.params.id, {
        ...req.body,
        analystId: req.user.sub,
      });
      res.status(201).json({ data: finding.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── GET /v1/hunts/:id/findings ────────────────────────────────────────────────
router.get(
  '/:id/findings',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const findings = await huntService.getFindings(req.params.id);
      res.json({ data: findings, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── Finding-Verdict (Block B2) ────────────────────────────────────────────────
// POST /v1/hunts/:id/findings/:findingId/verdict  { verdict }
// Erlaubt: '', 'benign', 'suspicious', 'malicious', 'inconclusive'
// RBAC: analyst+ darf Verdict setzen; viewer darf nur lesen.

router.post(
  '/:id/findings/:findingId/verdict',
  requireAuth,
  requireRole('analyst'),
  validate(setFindingVerdictSchema),
  async (req, res, next) => {
    try {
      const finding = await huntService.setFindingVerdict(
        req.params.id,
        req.params.findingId,
        req.body.verdict,
        req.user.sub,
      );
      res.json({ data: finding.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── Ticket-Links (P13.4) ──────────────────────────────────────────────────────

// POST /v1/hunts/:id/findings/:findingId/link-ticket
router.post(
  '/:id/findings/:findingId/link-ticket',
  requireAuth,
  requireRole('analyst'),
  validate(linkTicketSchema),
  async (req, res, next) => {
    try {
      const link = await huntService.linkFindingToTicket(
        req.params.id, req.params.findingId, req.body.ticketId, req.user.sub,
      );
      res.status(201).json({ data: link.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// POST /v1/hunts/:id/artifacts/:artifactId/link-ticket
router.post(
  '/:id/artifacts/:artifactId/link-ticket',
  requireAuth,
  requireRole('analyst'),
  validate(linkTicketSchema),
  async (req, res, next) => {
    try {
      const link = await huntService.linkArtifactToTicket(
        req.params.id, req.params.artifactId, req.body.ticketId, req.user.sub,
      );
      res.status(201).json({ data: link.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// POST /v1/hunts/:id/link-summary-to-ticket
router.post(
  '/:id/link-summary-to-ticket',
  requireAuth,
  requireRole('analyst'),
  validate(linkTicketSchema),
  async (req, res, next) => {
    try {
      const link = await huntService.linkSummaryToTicket(
        req.params.id, req.body.ticketId, req.user.sub,
      );
      res.status(201).json({ data: link.toJSON(), requestId: req.id });
    } catch (err) { next(err); }
  },
);

// GET /v1/hunts/:id/ticket-links
router.get(
  '/:id/ticket-links',
  requireAuth,
  requireRole('viewer'),
  async (req, res, next) => {
    try {
      const links = await huntService.getTicketLinks(req.params.id);
      res.json({ data: links, requestId: req.id });
    } catch (err) { next(err); }
  },
);

// ── Finding-Aktionen (P13.5) ───────────────────────────────────────────────────
// Erzeugt echtes SOC-Ticket bzw. Evidence-Item aus einem Finding.
// Linken eines BESTEHENDEN Tickets geht via .../findings/:findingId/link-ticket.

// POST /v1/hunts/:id/findings/:findingId/create-ticket
router.post(
  '/:id/findings/:findingId/create-ticket',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      const ticket = await huntService.createTicketFromFinding(
        req.params.id, req.params.findingId, req.user.sub,
      );
      res.status(201).json({
        data: { status: 'created', ticketId: ticket.id, ticket: ticket.toJSON ? ticket.toJSON() : ticket },
        requestId: req.id,
      });
    } catch (err) { next(err); }
  },
);

// POST /v1/hunts/:id/findings/:findingId/add-evidence
router.post(
  '/:id/findings/:findingId/add-evidence',
  requireAuth,
  requireRole('analyst'),
  async (req, res, next) => {
    try {
      const { evidence, ticketId } = await huntService.addFindingToEvidence(
        req.params.id, req.params.findingId, req.user.sub,
      );
      res.status(201).json({
        data: { status: 'created', evidenceId: evidence?.id, ticketId },
        requestId: req.id,
      });
    } catch (err) { next(err); }
  },
);

module.exports = router;
