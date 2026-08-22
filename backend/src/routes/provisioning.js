'use strict';

/**
 * provisioning-Router — /api/v1/provisioning  (P_AGENT_1)
 *
 * Zwei Zugriffsklassen:
 *   - Admin-Endpunkte (JWT + Rolle admin): Enrollment-Profile anlegen, Token minten.
 *   - Node-Endpunkte (Enrollment-Token): /enroll, /nodes/:id/heartbeat.
 *
 * **Reiner Steuer-/Beobachtungspfad — KEINE Commands, KEIN Apply, KEINE Netz-,
 * Firewall-, NAT-, DHCP- oder Routing-Aktion.** Der Server sendet an den Node
 * nur Informationen (serverTime, optional desiredProfileId) zurück.
 */

const { Router }                   = require('express');
const rateLimit                    = require('express-rate-limit');
const config                       = require('../config');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const validate                     = require('../middleware/validate');
const { createProvisioningRepository } = require('../repositories/provisioningRepositoryFactory');
const { EnrollmentTokenService }   = require('../services/EnrollmentTokenService');
const { NodeCredentialService }    = require('../services/NodeCredentialService');
const { NodeEnrollmentService }    = require('../services/NodeEnrollmentService');
const {
  createEnrollmentProfileSchema, mintTokenSchema, enrollSchema, heartbeatSchema,
  revokeCredentialSchema, retireNodeSchema, listNodesSchema, listAuditSchema,
} = require('../domain/validation/provisioningEnrollmentSchema');

const router = Router();

// ─── Rate-Limits (P_PROVISION_SECURITY_1) ────────────────────────────────────
// Gezielt nur auf /enroll und /heartbeat — NICHT global. 429 mit standardHeaders
// (RateLimit-Reset) + maschinenlesbarem Body, OHNE jegliches Secret zu spiegeln.
// Im Test default-inaktiv: nur aktiv, wenn die jeweilige PROV_*-ENV gesetzt ist
// (so stören sie die bestehende Test-Suite nicht; in Prod immer aktiv).
const tooMany = (req, res) => res.status(429).json({
  error: 'TOO_MANY_REQUESTS',
  message: 'Zu viele Anfragen — bitte später erneut versuchen.',
  requestId: req.id,
});
const skipUnlessConfiguredInTest = (envKey) => () => {
  // In Produktion werden die Limiter NIE übersprungen (Fail-Secure, auch wenn
  // jemand fälschlich NODE_ENV anders setzt). Nur im Test-Modus sind sie inaktiv,
  // solange das jeweilige PROV_*-Limit nicht explizit gesetzt ist.
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.NODE_ENV === 'test' && !process.env[envKey];
};

// Enroll: pro Quell-IP (Default-keyGenerator, IPv6-sicher), NUR fehlgeschlagene
// Versuche zählen → legitime Nodes mit gültigem Token werden nie blockiert.
const enrollLimiter = rateLimit({
  windowMs: config.provisioning.enroll.windowMs,
  max:      config.provisioning.enroll.max,
  skipSuccessfulRequests: config.provisioning.enroll.skipSuccessful,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: skipUnlessConfiguredInTest('PROV_ENROLL_MAX'),
  handler: tooMany,
});

// Heartbeat-Flood: pro nodeId (:id) — NAT-transparent. Mehrere Nodes hinter
// derselben NAT-IP blockieren sich NICHT gegenseitig.
const heartbeatFloodLimiter = rateLimit({
  windowMs: config.provisioning.heartbeat.nodeWindowMs,
  max:      config.provisioning.heartbeat.maxPerNode,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator: (req) => req.params.id, // nodeId, keine IP → kein IPv6-Sonderfall
  skip: skipUnlessConfiguredInTest('PROV_HEARTBEAT_MAX_PER_NODE'),
  handler: tooMany,
});

// Heartbeat-Auth-Fehler: pro Quell-IP, NUR fehlgeschlagene (4xx) Auth zählen.
// Gültige Heartbeats füllen den IP-Zähler nicht (skipSuccessfulRequests).
const heartbeatAuthFailLimiter = rateLimit({
  windowMs: config.provisioning.heartbeat.failWindowMs,
  max:      config.provisioning.heartbeat.failMaxPerIp,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: skipUnlessConfiguredInTest('PROV_HEARTBEAT_FAIL_MAX_PER_IP'),
  handler: tooMany,
});

// EINE geteilte Repo-Instanz für Route + beide Services (InMemory im Test/Dev,
// Postgres bei DB_ENABLED). Wichtig: InMemory-Repos teilen keinen State über
// mehrere Factory-Aufrufe — daher hier explizit injizieren.
const repo = createProvisioningRepository();
const enrollmentTokenService = new EnrollmentTokenService({ repo });
const nodeCredentialService = new NodeCredentialService({ repo });
const enrollmentService = new NodeEnrollmentService({ repo, tokenService: enrollmentTokenService, credentialService: nodeCredentialService });

// Enrollment-Token aus dem Authorization-Bearer-Header lesen (Node-Credential).
function bearerToken(req) {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

// ─── Admin: Enrollment-Profile ────────────────────────────────────────────────

router.post(
  '/enrollment-profiles',
  requireAuth, requireRole('admin'),
  validate(createEnrollmentProfileSchema),
  async (req, res, next) => {
    try {
      const created = await repo.createEnrollmentProfile(req.body);
      res.status(201).json({ data: created, requestId: req.id });
    } catch (err) { next(err); }
  }
);

router.get(
  '/enrollment-profiles',
  requireAuth, requireRole('admin'),
  async (req, res, next) => {
    try {
      const result = await repo.listEnrollmentProfiles({});
      res.json({ data: result.data, total: result.total, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// Token minten — Klartext-Token EINMALIG in der Response, danach nie wieder.
router.post(
  '/enrollment-profiles/:id/token',
  requireAuth, requireRole('admin'),
  validate(mintTokenSchema),
  async (req, res, next) => {
    try {
      const { token, enrollmentToken } = await enrollmentTokenService.mintToken({
        enrollmentProfileId: req.params.id,
        ttlSeconds: req.body.ttlSeconds,
      });
      res.status(201).json({ data: { token, enrollmentToken }, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// ─── Admin: Registry-Sicht (read-only) ────────────────────────────────────────

router.get(
  '/nodes',
  requireAuth, requireRole('admin'),
  validate(listNodesSchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, offset } = req.validatedQuery;
      const result = await repo.listNodes({ limit, offset });
      res.json({ data: result.data, total: result.total, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// Node-Detail inkl. Capabilities + Heartbeats (rein lesend; kein Apply/Command).
router.get(
  '/nodes/:id',
  requireAuth, requireRole('admin'),
  async (req, res, next) => {
    try {
      const node = await repo.getNode(req.params.id);
      if (!node) return res.status(404).json({ error: 'not_found', requestId: req.id });
      const [capabilities, heartbeats, latestHeartbeat] = await Promise.all([
        repo.listCapabilities(node.id),
        repo.listHeartbeats(node.id),
        repo.latestHeartbeat(node.id),
      ]);
      res.json({ data: { node, capabilities, heartbeats, latestHeartbeat }, requestId: req.id });
    } catch (err) { next(err); }
  }
);

router.get(
  '/audit',
  requireAuth, requireRole('admin'),
  validate(listAuditSchema, 'query'),
  async (req, res, next) => {
    try {
      const result = await repo.listAudit(req.validatedQuery);
      res.json({ data: result.data, total: result.total, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// ─── Admin: Credential-Lifecycle (Revoke / Retire) ───────────────────────────

// Alle Node-Credentials einer Node (rein lesend; NIE Hash/Klartext — toJSON redacted).
router.get(
  '/nodes/:id/credentials',
  requireAuth, requireRole('admin'),
  async (req, res, next) => {
    try {
      const credentials = await repo.listNodeCredentials(req.params.id);
      res.json({ data: credentials, total: credentials.length, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// Ein einzelnes Credential widerrufen. Cross-Node-Schutz: die credId MUSS zu :id
// gehören, sonst 404. Idempotent: bereits widerrufen → 200 mit aktuellem Status.
router.post(
  '/nodes/:id/credentials/:credId/revoke',
  requireAuth, requireRole('admin'),
  validate(revokeCredentialSchema),
  async (req, res, next) => {
    try {
      const credentials = await repo.listNodeCredentials(req.params.id);
      const target = credentials.find((c) => c.id === req.params.credId);
      if (!target) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Credential gehört nicht zu dieser Node', requestId: req.id });
      }
      if (target.status !== 'active') {
        return res.json({ data: target, requestId: req.id }); // idempotent: schon widerrufen
      }
      const revoked = await nodeCredentialService.revoke(req.params.credId, req.body.reason || null);
      res.json({ data: revoked || target, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// Node stilllegen (retire) — widerruft aktive Credentials + terminaler Statuswechsel.
router.post(
  '/nodes/:id/retire',
  requireAuth, requireRole('admin'),
  validate(retireNodeSchema),
  async (req, res, next) => {
    try {
      const result = await enrollmentService.retireNode(req.params.id, req.body.reason || null);
      res.json({ data: result, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// ─── Node: Enroll (Token im Body oder Bearer-Header) ──────────────────────────

router.post(
  '/enroll',
  enrollLimiter,
  validate(enrollSchema),
  async (req, res, next) => {
    try {
      const token = bearerToken(req) || req.body.token;
      const result = await enrollmentService.enroll({ ...req.body, token });
      res.status(201).json({ data: result, requestId: req.id });
    } catch (err) { next(err); }
  }
);

// ─── Node: Heartbeat (Node-Credential via Bearer-Header) ──────────────────────
// Authentifiziert ausschließlich über das Node-Credential aus dem Enrollment —
// NICHT über den Enrollment-Token (der ist Single-Use/Bootstrap). Das Credential
// muss an genau diese Node gebunden sein (nodeId == :id).

router.post(
  '/nodes/:id/heartbeat',
  heartbeatFloodLimiter,
  heartbeatAuthFailLimiter,
  validate(heartbeatSchema),
  async (req, res, next) => {
    try {
      const auth = await nodeCredentialService.authenticate(bearerToken(req));
      if (!auth) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Gültiges Node-Credential erforderlich', requestId: req.id });
      }
      if (auth.nodeId !== req.params.id) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Credential ist nicht an diese Node gebunden', requestId: req.id });
      }
      const result = await enrollmentService.recordHeartbeat(req.params.id, req.body);
      res.json({ data: result, requestId: req.id });
    } catch (err) { next(err); }
  }
);

module.exports = router;
