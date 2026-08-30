'use strict';

// ── Route /api/v1/otrs — OTRS/Znuny-Outbound-Verbindung (Layer 2, admin) ────────
//
// GET  /connection       — maskiert (nie das Passwort)
// PUT  /connection       — speichern (admin + Passwort-Step-up + Audit) + sofort anwenden
// POST /connection/test  — read-only Verbindungstest (SessionCreate), ohne Speichern
//
// Der externalTicketConnectionApplier reconfiguriert den Singleton-Adapter nach dem
// Speichern → eine Änderung greift sofort, ohne Neustart.

const { Router } = require('express');
const rateLimit  = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { authService }              = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { resolveOtrsConnection, saveOtrsConnection, maskedOtrsConnection } = require('../services/otrsConnectionSettings');
const { applyExternalTicketConnections } = require('../integrations/externalTicketConnectionApplier');
const { otrsConnectionSchema }     = require('../domain/validation/otrsConnectionSchema');
const { isBlockedSsrfUrlResolved, ssrfBlockReason, plaintextCredentialWarning } = require('../integrations/http/internalUrlAllowlist');
const { OTRSAdapter }              = require('../integrations/adapters/otrs/OTRSAdapter');
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

// Testbarer Probe-Seam: Default baut den echten OTRS-Adapter (RealHttpClient, geboundeter
// Timeout) und rekonfiguriert ihn auf die effektive Verbindung. Wird NIE über HTTP gesetzt —
// nur Tests injizieren via router.setProbeFactory() einen Fake-Probe. null → Default zurück.
const defaultOtrsProbeFactory = ({ baseUrl, username, password, webService }) => {
  const probe = new OTRSAdapter({ httpClient: new RealHttpClient({ timeout: TEST_TIMEOUT_MS, ssrfProtection: true }) });
  probe.reconfigure({ baseUrl, username, password, webService });
  return probe;
};
let otrsProbeFactory = defaultOtrsProbeFactory;
router.setProbeFactory = (fn) => { otrsProbeFactory = fn || defaultOtrsProbeFactory; };

// GET /api/v1/otrs/connection
router.get('/connection', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedOtrsConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT /api/v1/otrs/connection — admin + Passwort-Step-up.
router.put('/connection', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  const actor = { actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '' };
  try {
    const { error, value } = otrsConnectionSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
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
        ...actor, action: AUDIT_ACTIONS.OTRS_CONNECTION_CHANGE_DENIED,
        targetType: 'otrs_connection', targetId: 'otrs', metadata: { outcome: 'denied_invalid_password' },
      }).catch((e) => logger.error('otrs_conn_audit_failed', { error: e.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    try {
      await saveOtrsConnection(settingsRepo, {
        baseUrl: value.baseUrl, username: value.username, password: value.otrsPassword,
        queue: value.queue, webService: value.webService, operation: value.operation,
      });
    } catch (err) {
      if (err.code === 'OTRS_INCOMPLETE') {
        return res.status(400).json({ error: 'OTRS_INCOMPLETE', message: err.message, requestId: req.id });
      }
      throw err;
    }
    await applyExternalTicketConnections(settingsRepo);

    await auditService.write({
      ...actor, action: AUDIT_ACTIONS.OTRS_CONNECTION_CHANGED,
      targetType: 'otrs_connection', targetId: 'otrs',
      metadata: { baseUrlSet: value.baseUrl !== '', usernameSet: (value.username || '') !== '', passwordSet: (value.otrsPassword || '') !== '' },
    });

    res.json({ data: await maskedOtrsConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/otrs/connection/test — read-only Probe (SessionCreate), ohne Speichern.
router.post('/connection/test', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  try {
    const bodyUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
    if (bodyUrl !== '' && !/^https?:\/\//i.test(bodyUrl)) {
      return res.status(400).json({ error: 'INVALID_URL', message: 'OTRS-URL muss http(s) sein.', requestId: req.id });
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
    const eff = await resolveOtrsConnection(settingsRepo);
    const targetChanged = bodyUrl !== '' && bodyUrl.replace(/\/+$/, '') !== String(eff.baseUrl || '').replace(/\/+$/, '');
    const hasBodyCredentials = typeof req.body?.username === 'string' && req.body.username.trim() !== ''
      && typeof req.body?.otrsPassword === 'string' && req.body.otrsPassword.trim() !== '';
    if (targetChanged && !hasBodyCredentials) {
      return res.status(400).json({ error: 'CREDENTIAL_TARGET_MISMATCH', message: 'Bei geaendertem Ziel muessen Benutzername und Passwort neu angegeben werden.', requestId: req.id });
    }
    const baseUrl  = bodyUrl !== '' ? bodyUrl : eff.baseUrl;
    const username = typeof req.body?.username === 'string' && req.body.username.trim() !== '' ? req.body.username.trim() : eff.username;
    const password = typeof req.body?.otrsPassword === 'string' && req.body.otrsPassword.trim() !== '' ? req.body.otrsPassword.trim() : eff.password;
    const webService = typeof req.body?.webService === 'string' && req.body.webService.trim() !== '' ? req.body.webService.trim() : eff.webService;
    if (baseUrl && await isBlockedSsrfUrlResolved(baseUrl)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-URL nicht erlaubt (Loopback/Metadaten).', requestId: req.id });
    }
    if (!baseUrl || !username || !password) {
      return res.json({ data: { ok: false, reason: 'not_configured' }, requestId: req.id });
    }

    const probe = otrsProbeFactory({ baseUrl, username, password, webService });
    const t0 = Date.now();
    let result;
    try {
      await probe.testConnection();
      result = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      // Rohen Fehler nur serverseitig loggen; dem Client nur eine sichere Kategorie (kein Info-Disclosure).
      logger.warn('otrs_conn_test_probe_failed', { host: hostFromUrl(baseUrl), error: err.message });
      result = { ok: false, reason: 'error', error: classifyConnError(err), latencyMs: Date.now() - t0 };
    }
    // Non-blocking: warnt, wenn Creds unverschlüsselt (http) an ein externes Ziel gingen.
    const warning = plaintextCredentialWarning(baseUrl);
    if (warning) result.warning = warning;
    await auditService.write({
      actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '',
      action: AUDIT_ACTIONS.OTRS_CONNECTION_TEST, targetType: 'otrs_connection', targetId: 'otrs',
      metadata: { host: hostFromUrl(baseUrl), ok: result.ok },
    }).catch((e) => logger.error('otrs_conn_test_audit_failed', { error: e.message }));

    res.json({ data: result, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
