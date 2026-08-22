'use strict';

// Wazuh-Hosts/Inventory — liest registrierte Agents + syscollector aus der Wazuh-API.
// Reiner Read-Proxy; kein eigenes Datenmodell. RBAC: requireAuth (viewer+).

const { Router }            = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { wazuhApiClient }    = require('../integrations/adapters/wazuh/wazuhApiInstance');
const { wazuhIndexerClient } = require('../integrations/adapters/wazuh/wazuhIndexerInstance');
const config                = require('../config');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { isWazuhRestartArmed } = require('../services/wazuhRestartArm');
const wazuhRestartArmStore  = require('../services/wazuhRestartArmStore');
const logger                = require('../logger');
const rateLimit             = require('express-rate-limit');

const router = Router();

// Strenger Limiter NUR für den Manager-Restart (Remote-Service-Steuerung): ein Admin
// darf den Wazuh-Manager nicht im Sekundentakt neustarten (DoS-Schutz). Pro User gekeyt
// (requireAuth läuft davor → user.id gesetzt, kein IP-Fallback nötig). Im Test inaktiv.
const restartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Restart-Anfragen — bitte später erneut.' },
});

const restartActor = (req) => ({
  actorUserId: req.user?.id || null,
  actorLabel:  req.user?.email || req.user?.displayName || '',
  ip:          req.ip || '',
});

// GET /api/v1/wazuh/agents — registrierte Agents inkl. Heartbeat-Status
router.get('/agents', requireAuth, async (req, res, next) => {
  try {
    if (!wazuhApiClient.isEnabled()) {
      return res.json({ enabled: false, data: [], total: 0, requestId: req.id });
    }
    const agents = await wazuhApiClient.listAgents();
    res.json({ enabled: true, data: agents, total: agents.length, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/wazuh/agents/:id/inventory — syscollector (OS, Hardware, Netz, Pakete, Ports)
router.get('/agents/:id/inventory', requireAuth, async (req, res, next) => {
  try {
    if (!wazuhApiClient.isEnabled()) {
      return res.json({ enabled: false, data: null, requestId: req.id });
    }
    const inventory = await wazuhApiClient.getAgentInventory(req.params.id);
    res.json({ enabled: true, data: inventory, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/wazuh/agents/:id/posture — SCA-Compliance (API) + CVE-Counts (Indexer).
// Speist den Host-Risk-Score mit echten SCA/Vuln-Daten. Beide Quellen weich:
// fällt eine aus, liefert sie null (kein 500).
router.get('/agents/:id/posture', requireAuth, async (req, res, next) => {
  try {
    if (!wazuhApiClient.isEnabled()) {
      return res.json({ enabled: false, data: null, requestId: req.id });
    }
    const [sca, vulnerabilities] = await Promise.all([
      wazuhApiClient.getAgentSca(req.params.id).catch(() => null),
      wazuhIndexerClient.isEnabled() ? wazuhIndexerClient.agentVulnerabilities(req.params.id).catch(() => null) : null,
    ]);
    res.json({ enabled: true, data: { sca, vulnerabilities }, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/wazuh/manager/restart — Manager via Wazuh-API neu starten (W6).
// Security-sensibel (Remote-Service-Steuerung): admin-only + ENV-Gate
// WAZUH_MANAGER_RESTART_ENABLED (default false → 403 'disabled') + Audit.
// Optional vorab Config-Validierung — bei invalider Config KEIN Restart (422).
router.post('/manager/restart', requireAuth, requireRole('admin'), restartLimiter, async (req, res, next) => {
  const actor = restartActor(req);
  try {
    // 1) Safety-Gate: ohne explizite Scharfschaltung NIE neu starten.
    //    Scharf = ENV-Fallback (WAZUH_MANAGER_RESTART_ENABLED) ODER per UI
    //    persistiertes DB-Flag. Die ENV bleibt als Break-Glass/Override erhalten.
    const dbArmed = await wazuhRestartArmStore.isArmed();
    if (!isWazuhRestartArmed({ envEnabled: config.wazuh.managerRestartEnabled, dbArmed })) {
      return res.status(403).json({
        error: 'disabled',
        message: 'Wazuh-Manager-Restart ist nicht scharfgeschaltet (per UI scharfschalten oder WAZUH_MANAGER_RESTART_ENABLED=true).',
        requestId: req.id,
      });
    }

    // 2) API muss konfiguriert sein.
    if (!wazuhApiClient.isEnabled()) {
      return res.status(409).json({
        error: 'not_configured',
        message: 'Wazuh-API ist nicht konfiguriert.',
        requestId: req.id,
      });
    }

    // 3) Optionale Config-Validierung vor dem Restart — invalide Config → NICHT neu
    //    starten (sonst kommt der Manager mit kaputtem Ruleset nicht mehr hoch).
    const validate = req.body?.validate !== false; // default: validieren
    if (validate) {
      const v = await wazuhApiClient.validateConfiguration();
      if (!v.ok) {
        await auditService.write({
          ...actor,
          action: AUDIT_ACTIONS.WAZUH_MANAGER_RESTART,
          targetType: 'wazuh_manager', targetId: 'manager',
          metadata: { outcome: 'aborted_invalid_config', validationStatus: v.status },
        });
        return res.status(422).json({
          error: 'invalid_config',
          message: 'Wazuh-Konfiguration ist nicht valide — Restart abgebrochen.',
          validationStatus: v.status,
          requestId: req.id,
        });
      }
    }

    // 4) Restart. Der Client bestätigt den Erfolg über Status-Polling (API-Selbstmord).
    const result = await wazuhApiClient.restartManager();

    await auditService.write({
      ...actor,
      action: AUDIT_ACTIONS.WAZUH_MANAGER_RESTART,
      targetType: 'wazuh_manager', targetId: 'manager',
      metadata: { outcome: 'restarted', validated: validate, confirmed: Boolean(result?.confirmed) },
    });

    // Security: NICHT die rohe Wazuh-API-Antwort durchreichen (kann interne Metadaten
    // tragen) — nur explizit das, was der Client braucht.
    res.json({ ok: true, restarted: true, confirmed: Boolean(result?.confirmed), requestId: req.id });
  } catch (err) {
    // Audit auch bei Fehler — aber KEIN Secret/keine rohe API-Antwort ins Log/Response.
    await auditService.write({
      ...actor,
      action: AUDIT_ACTIONS.WAZUH_MANAGER_RESTART,
      targetType: 'wazuh_manager', targetId: 'manager',
      metadata: { outcome: 'failed', reason: String(err && err.message ? err.message : 'error').slice(0, 200) },
    }).catch((auditErr) => logger.error('wazuh_restart_audit_failed', { error: auditErr.message }));

    return res.status(err.status === 504 ? 504 : 502).json({
      error: 'restart_failed',
      message: 'Wazuh-Manager-Restart fehlgeschlagen.',
      requestId: req.id,
    });
  }
});

module.exports = router;
