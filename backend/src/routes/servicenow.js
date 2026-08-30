'use strict';

// ── Route /api/v1/servicenow — ServiceNow-Outbound-Verbindung (Layer 2, admin) ──
//
// GET  /connection       — maskiert (nie das Passwort)
// PUT  /connection       — speichern (admin + Passwort-Step-up + Audit) + sofort anwenden
// POST /connection/test  — read-only Verbindungstest (Table-GET limit=1), ohne Speichern
//
// Der externalTicketConnectionApplier reconfiguriert den Singleton-Adapter nach dem
// Speichern → eine Änderung greift sofort, ohne Neustart.

const { Router } = require('express');
const rateLimit  = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { authService }              = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { resolveServicenowConnection, saveServicenowConnection, maskedServicenowConnection } = require('../services/servicenowConnectionSettings');
const { applyExternalTicketConnections } = require('../integrations/externalTicketConnectionApplier');
const { servicenowConnectionSchema } = require('../domain/validation/servicenowConnectionSchema');
const { isBlockedSsrfUrlResolved, ssrfBlockReason } = require('../integrations/http/internalUrlAllowlist');
const { ServiceNowAdapter }        = require('../integrations/adapters/servicenow/ServiceNowAdapter');
const { RealHttpClient }           = require('../integrations/http/RealHttpClient');
const { classifyConnError }        = require('../integrations/http/connErrorClassifier');
const logger                       = require('../logger');

const router = Router();
const settingsRepo = createSettingsRepository();
const hostFromUrl = (url) => { try { return new URL(url).host; } catch { return ''; } };
const TEST_TIMEOUT_MS = 4000;

const connLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Versuche — bitte später erneut.' },
});

// GET /api/v1/servicenow/connection
router.get('/connection', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedServicenowConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT /api/v1/servicenow/connection — admin + Passwort-Step-up.
router.put('/connection', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  const actor = { actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '' };
  try {
    const { error, value } = servicenowConnectionSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/['"]/g, '') }));
      return res.status(400).json({ error: 'VALIDATION_ERROR', details, requestId: req.id });
    }
    if (value.baseUrl !== '' && await isBlockedSsrfUrlResolved(value.baseUrl)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-URL nicht erlaubt (Loopback/Metadaten).', requestId: req.id });
    }

    const admin = await authService._findById(req.user?.sub);
    const valid = admin && admin.passwordHash ? await authService.verifyPassword(value.password, admin.passwordHash) : false;
    if (!valid) {
      await auditService.write({
        ...actor, action: AUDIT_ACTIONS.SERVICENOW_CONNECTION_CHANGE_DENIED,
        targetType: 'servicenow_connection', targetId: 'servicenow', metadata: { outcome: 'denied_invalid_password' },
      }).catch((e) => logger.error('servicenow_conn_audit_failed', { error: e.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    try {
      await saveServicenowConnection(settingsRepo, {
        baseUrl: value.baseUrl, username: value.username, password: value.servicenowPassword, table: value.table,
      });
    } catch (err) {
      if (err.code === 'SERVICENOW_INCOMPLETE') {
        return res.status(400).json({ error: 'SERVICENOW_INCOMPLETE', message: err.message, requestId: req.id });
      }
      throw err;
    }
    await applyExternalTicketConnections(settingsRepo);

    await auditService.write({
      ...actor, action: AUDIT_ACTIONS.SERVICENOW_CONNECTION_CHANGED,
      targetType: 'servicenow_connection', targetId: 'servicenow',
      metadata: { baseUrlSet: value.baseUrl !== '', usernameSet: (value.username || '') !== '', passwordSet: (value.servicenowPassword || '') !== '' },
    });

    res.json({ data: await maskedServicenowConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/servicenow/connection/test — read-only Probe (Table-GET), ohne Speichern.
router.post('/connection/test', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  try {
    const bodyUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
    if (bodyUrl !== '' && !/^https:\/\//i.test(bodyUrl)) {
      return res.status(400).json({ error: 'INVALID_URL', message: 'ServiceNow-URL muss https sein.', requestId: req.id });
    }
    // Blockieren bleibt fail-closed — aber der GRUND wird benannt: ein nicht
    // auflösbarer Hostname als „Loopback/Metadaten" zu melden schickt den Admin
    // auf die falsche Fährte (der häufigste Fall ist ein Tippfehler oder fehlendes
    // DNS im Nexora-Container, nicht ein SSRF-Versuch).
    const ssrfReason = bodyUrl !== '' ? await ssrfBlockReason(bodyUrl) : null;
    if (ssrfReason) {
      return res.status(400).json(ssrfReason === 'unresolvable'
        ? { error: 'UNRESOLVABLE_HOST', message: 'Hostname nicht auflösbar — Schreibweise prüfen bzw. DNS des Nexora-Containers.', requestId: req.id }
        : { error: 'BLOCKED_URL', message: 'Ziel-URL nicht erlaubt (Loopback/Metadaten).', requestId: req.id });
    }
    const eff = await resolveServicenowConnection(settingsRepo);
    const targetChanged = bodyUrl !== '' && bodyUrl.replace(/\/+$/, '') !== String(eff.baseUrl || '').replace(/\/+$/, '');
    const hasBodyCredentials = typeof req.body?.username === 'string' && req.body.username.trim() !== ''
      && typeof req.body?.servicenowPassword === 'string' && req.body.servicenowPassword.trim() !== '';
    if (targetChanged && !hasBodyCredentials) {
      return res.status(400).json({ error: 'CREDENTIAL_TARGET_MISMATCH', message: 'Bei geaendertem Ziel muessen Benutzername und Passwort neu angegeben werden.', requestId: req.id });
    }
    const baseUrl  = bodyUrl !== '' ? bodyUrl : eff.baseUrl;
    const username = typeof req.body?.username === 'string' && req.body.username.trim() !== '' ? req.body.username.trim() : eff.username;
    const password = typeof req.body?.servicenowPassword === 'string' && req.body.servicenowPassword.trim() !== '' ? req.body.servicenowPassword.trim() : eff.password;
    const table    = typeof req.body?.table === 'string' && req.body.table.trim() !== '' ? req.body.table.trim() : eff.table;
    if (baseUrl && await isBlockedSsrfUrlResolved(baseUrl)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-URL nicht erlaubt (Loopback/Metadaten).', requestId: req.id });
    }
    if (!baseUrl || !username || !password) {
      return res.json({ data: { ok: false, reason: 'not_configured' }, requestId: req.id });
    }

    const probe = new ServiceNowAdapter({ httpClient: new RealHttpClient({ timeout: TEST_TIMEOUT_MS, ssrfProtection: true }) });
    probe.reconfigure({ baseUrl, username, password, table });
    const t0 = Date.now();
    let result;
    try {
      await probe.testConnection();
      result = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      // Rohen Fehler nur serverseitig loggen; dem Client nur eine sichere Kategorie (kein Info-Disclosure).
      logger.warn('servicenow_conn_test_probe_failed', { host: hostFromUrl(baseUrl), error: err.message });
      result = { ok: false, reason: 'error', error: classifyConnError(err), latencyMs: Date.now() - t0 };
    }
    await auditService.write({
      actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '',
      action: AUDIT_ACTIONS.SERVICENOW_CONNECTION_TEST, targetType: 'servicenow_connection', targetId: 'servicenow',
      metadata: { host: hostFromUrl(baseUrl), ok: result.ok },
    }).catch((e) => logger.error('servicenow_conn_test_audit_failed', { error: e.message }));

    res.json({ data: result, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
