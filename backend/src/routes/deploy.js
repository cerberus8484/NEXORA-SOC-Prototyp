'use strict';

// ─────────────────────────────────────────────────────────────────────────
// /api/v1/deploy — Deployment Center (ADR-041). Infra-schreibender Kanal.
//
// RBAC: ALLES admin-only. Apply zusätzlich hinter frischer Reauth
// (X-Reauth-Token, purpose deploy_reauth), dem DEPLOY_ENABLED-Kill-Switch,
// Vier-Augen und den Deploy-Gates (im Service/Orchestrator erzwungen).
// Unbekanntes Modul/Connector = deny (Katalog/Service).
// ─────────────────────────────────────────────────────────────────────────

const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const { getDeployService } = require('../deploy/deployServiceFactory');
const { getNodeUpdateService } = require('../services/nodeUpdateServiceFactory');
const { authService } = require('../services/AuthService');
const { auditService } = require('../services/AuditService');
const { getDeployKeypair, generateDeployKeypair } = require('../services/deployKeypairSettings');
const { createConnectorSchema, createSpecSchema, approveSchema, applySchema } = require('../domain/validation/deploySchema');

// NodeUpdateError-Code → HTTP-Status. Die Fehlermeldungen sind statisch/redigiert
// (der Service leakt nie Roh-Fehler/Secrets), daher fürs UI unbedenklich zurückgebbar.
const NODE_UPDATE_STATUS = {
  E_NOT_ARMED: 403, E_REAUTH: 401, E_BAD_VERSION: 400, E_NOT_FOUND: 404,
  E_UNSUPPORTED: 400, E_NO_HOST: 400, E_NO_HOSTKEY: 409, E_NO_CHANNEL: 503, E_SSH: 502,
  E_TIMEOUT: 504, E_UPDATE_FAILED: 502,
};

const router = Router();

function svc() { return getDeployService(); }
function actorFrom(req) {
  return { id: req.user && req.user.sub, role: req.user && req.user.role, label: (req.user && (req.user.email || req.user.sub)) || '' };
}

// ── Kataloge / read (admin) ──
router.get('/modules', requireAuth, requireRole('admin'), async (req, res, next) => {
  try { res.json({ data: svc().listModules(), requestId: req.id }); } catch (err) { next(err); }
});

router.get('/connectors', requireAuth, requireRole('admin'), async (req, res, next) => {
  try { res.json({ data: await svc().listConnectors(), requestId: req.id }); } catch (err) { next(err); }
});

// ── Connector anlegen (Token wird im Service verschlüsselt; frische Reauth wie Apply) ──
router.post('/connectors', requireAuth, requireRole('admin'), validate(createConnectorSchema), async (req, res, next) => {
  try { res.status(201).json({ data: await svc().createConnector(req.body, actorFrom(req), req.get('X-Reauth-Token')), requestId: req.id }); } catch (err) { next(err); }
});

// ── Spec anlegen (validiert + idempotent) ──
router.post('/specs', requireAuth, requireRole('admin'), validate(createSpecSchema), async (req, res, next) => {
  try { res.status(201).json({ data: await svc().createSpec(req.body, actorFrom(req)), requestId: req.id }); } catch (err) { next(err); }
});

// ── Plan (Dry-Run, kein Infra-Write) → erzeugt einen planned Run ──
router.post('/specs/:id/plan', requireAuth, requireRole('admin'), async (req, res, next) => {
  try { res.json({ data: await svc().plan(req.params.id, actorFrom(req)), requestId: req.id }); } catch (err) { next(err); }
});

// ── Approve (Vier-Augen: Ersteller ≠ Genehmiger) ──
router.post('/runs/:runId/approve', requireAuth, requireRole('admin'), validate(approveSchema), async (req, res, next) => {
  try { res.json({ data: await svc().approve(req.params.runId, actorFrom(req), req.body.note), requestId: req.id }); } catch (err) { next(err); }
});

// ── Apply (admin + X-Reauth-Token + DEPLOY_ENABLED-Gate + Gates + Rollback) ──
router.post('/runs/:runId/apply', requireAuth, requireRole('admin'), validate(applySchema), async (req, res, next) => {
  try { res.json({ data: await svc().apply(req.params.runId, actorFrom(req), req.get('X-Reauth-Token')), requestId: req.id }); } catch (err) { next(err); }
});

// ── Run-Detail + Schritte (admin, read) ──
router.get('/runs/:runId', requireAuth, requireRole('admin'), async (req, res, next) => {
  try { res.json({ data: await svc().getRun(req.params.runId), requestId: req.id }); } catch (err) { next(err); }
});

// ── Deploy-Audit (admin, read; optional gefiltert nach runId/specId) ──
router.get('/audit', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.runId) filter.runId = String(req.query.runId);
    if (req.query.specId) filter.specId = String(req.query.specId);
    res.json({ data: await svc().listAudit(filter), requestId: req.id });
  } catch (err) { next(err); }
});

// ── Node-Update („updatebar"): admin + frische Reauth (X-Reauth-Token). Arm-Flag
// (NODE_UPDATE_ENABLED), Node-Auflösung aus der Registry + Ausführung macht der
// Service (fail-closed); Host kommt aus der Registry, NIE aus dem Request-Body. ──
router.post('/nodes/:nodeId/update', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = await getNodeUpdateService().updateNode(req.params.nodeId, {
      actor: actorFrom(req),
      reauthToken: req.get('X-Reauth-Token'),
      agentVersion: req.body && req.body.agentVersion,
    });
    res.status(200).json({ data, requestId: req.id });
  } catch (err) {
    if (err && err.name === 'NodeUpdateError') {
      return res.status(NODE_UPDATE_STATUS[err.code] || 400).json({ error: err.code, message: err.message, requestId: req.id });
    }
    next(err);
  }
});

// ── Host-Key erfassen + pinnen (Option 2, Prep für Updates): admin + frische Reauth.
// Scannt den Host-Key des Nodes (IP aus der Registry) und pinnt ihn; gibt den
// Fingerprint zurück (der Admin verifiziert ihn out-of-band). Kein Arm-Flag nötig. ──
router.post('/nodes/:nodeId/hostkey/capture', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const data = await getNodeUpdateService().captureHostKey(req.params.nodeId, {
      actor: actorFrom(req), reauthToken: req.get('X-Reauth-Token'),
    });
    res.status(200).json({ data, requestId: req.id });
  } catch (err) {
    if (err && err.name === 'NodeUpdateError') {
      return res.status(NODE_UPDATE_STATUS[err.code] || 400).json({ error: err.code, message: err.message, requestId: req.id });
    }
    next(err);
  }
});

// ── Platform-Deploy-Keypair (Slice 6d): das SSH-Keypair, mit dem Nexora deployte
// Server für Updates erreicht. GET = maskiert (nie der Private-Key). ──
router.get('/keypair', requireAuth, requireRole('admin'), async (req, res, next) => {
  try { res.json({ data: await getDeployKeypair(), requestId: req.id }); } catch (err) { next(err); }
});

// POST /deploy/keypair/generate — generiert/rotiert das Keypair (admin + frische Reauth).
// Rotieren invalidiert bestehende authorized_keys-Provisionierungen → auditiert.
router.post('/keypair/generate', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const actor = actorFrom(req);
    const reauth = await authService.verifyDeployReauth(req.get('X-Reauth-Token'), actor.id);
    if (!reauth || !reauth.ok) {
      return res.status(401).json({ error: 'E_REAUTH', message: 'Frische Reauth erforderlich (X-Reauth-Token).', requestId: req.id });
    }
    const data = await generateDeployKeypair();
    await auditService.write({
      actorUserId: actor.id ?? null, actorLabel: actor.label ?? 'unknown', ip: req.ip || '',
      action: 'DEPLOY_KEYPAIR_GENERATED', targetType: 'deploy_keypair', targetId: 'deploy_keypair',
      metadata: { fingerprint: data.fingerprint }, // öffentlicher Fingerprint, kein Secret
    }).catch(() => {});
    res.status(201).json({ data, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
