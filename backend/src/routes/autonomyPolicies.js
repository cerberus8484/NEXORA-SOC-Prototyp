'use strict';

/**
 * autonomyPolicies-Router — /api/v1/autonomy-policies
 *
 * RBAC: admin-only für alle Routen (Policies sind Admin-Sache).
 * KEIN Live-Aktionspfad — reines CRUD + Status-Auskunft.
 * Der AutonomyEvaluator wird hier NICHT aufgerufen.
 *
 * ADR-016: Autonomie-Fundament, Default-Advisory, Default-Deny.
 * AUTONOMY_ENABLED Default = false (ENV-Flag, config.autonomy.enabled).
 */

const { Router }                   = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const validate                     = require('../middleware/validate');
const config                       = require('../config');
const { ACTION_CLASSES, MODES, VERDICTS, CEILINGS } = require('../domain/AutonomyPolicy');
const {
  createAutonomyPolicySchema,
  updateAutonomyPolicySchema,
  listAutonomyPoliciesSchema,
} = require('../domain/validation/autonomyPolicySchema');
const { createAutonomyPolicyRepository } = require('../repositories/autonomyPolicyRepositoryFactory');
const { auditService } = require('../services/AuditService');

const router = Router();

// Singleton-Repository (InMemory im Test/Dev, Postgres bei DB_ENABLED)
const repo = createAutonomyPolicyRepository();

// ─── GET /status (vor /:id!) ──────────────────────────────────────────────────
// Liefert den aktuellen Kill-Switch-Status und die Enum-Konstanten.
// Nützlich für Admin-UI und Feature-Toggle-Checks.

router.get(
  '/status',
  requireAuth, requireRole('admin'),
  (req, res) => {
    res.json({
      data: {
        enabled:      config.autonomy.enabled, // Default false
        actionClasses: ACTION_CLASSES,
        ceilings:     CEILINGS,
        modes:        MODES,
        verdicts:     VERDICTS,
      },
      requestId: req.id,
    });
  }
);

// ─── GET / (Liste) ────────────────────────────────────────────────────────────

router.get(
  '/',
  requireAuth, requireRole('admin'),
  validate(listAutonomyPoliciesSchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, offset } = req.validatedQuery;
      const result = await repo.findAll({ limit, offset });
      res.json({ data: result.data, total: result.total, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get(
  '/:id',
  requireAuth, requireRole('admin'),
  async (req, res, next) => {
    try {
      const policy = await repo.findById(req.params.id);
      if (!policy) {
        return res.status(404).json({ error: 'not_found', requestId: req.id });
      }
      res.json({ data: policy, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// ─── POST / ───────────────────────────────────────────────────────────────────

router.post(
  '/',
  requireAuth, requireRole('admin'),
  validate(createAutonomyPolicySchema),
  async (req, res, next) => {
    try {
      // createdBy aus dem authentifizierten User befüllen wenn nicht angegeben
      const data = {
        ...req.body,
        createdBy: req.body.createdBy || req.user?.email || req.user?.sub || '',
      };
      const created = await repo.create(data);
      // P_TRUST_1 A5: sicherheitskritische Policy-Änderung auditieren (nur sichere Metadaten).
      await auditService.write({
        actorUserId: req.user?.sub, actorLabel: req.user?.email || 'unknown',
        action: 'AUTONOMY_POLICY_CREATED', targetType: 'autonomy_policy', targetId: created.id, ip: req.ip,
        metadata: { actionClass: created.actionClass, mode: created.mode },
      });
      res.status(201).json({ data: created, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

router.put(
  '/:id',
  requireAuth, requireRole('admin'),
  validate(updateAutonomyPolicySchema),
  async (req, res, next) => {
    try {
      const updated = await repo.update(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: 'not_found', requestId: req.id });
      }
      await auditService.write({
        actorUserId: req.user?.sub, actorLabel: req.user?.email || 'unknown',
        action: 'AUTONOMY_POLICY_UPDATED', targetType: 'autonomy_policy', targetId: updated.id, ip: req.ip,
        metadata: { fields: req.rawBodyKeys || Object.keys(req.body || {}) }, // nur Feldnamen, keine Werte
      });
      res.json({ data: updated, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete(
  '/:id',
  requireAuth, requireRole('admin'),
  async (req, res, next) => {
    try {
      await repo.delete(req.params.id);
      await auditService.write({
        actorUserId: req.user?.sub, actorLabel: req.user?.email || 'unknown',
        action: 'AUTONOMY_POLICY_DELETED', targetType: 'autonomy_policy', targetId: req.params.id, ip: req.ip,
      });
      res.status(204).end();
    } catch (err) { next(err); }
  }
);

module.exports = router;
