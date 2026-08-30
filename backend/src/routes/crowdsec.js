'use strict';

// ── Route /api/v1/crowdsec — CrowdSec-LAPI-Verbindung (Layer 2, admin) ────────
//
// GET  /connection       — maskiert (nie das Passwort)
// PUT  /connection       — speichern (admin + Passwort-Step-up + Audit)
// POST /connection/test  — Verbindungstest (login gegen LAPI), ohne Speichern
//
// Kein Applier: der CrowdsecPoller löst die Verbindung pro Zyklus aus DB > ENV auf
// → eine Änderung greift beim nächsten Poll-Lauf (≤ Poll-Intervall), ohne Neustart.

const { Router } = require('express');
const rateLimit  = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { authService }              = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { resolveCrowdsecConnection, saveCrowdsecConnection, maskedCrowdsecConnection } = require('../services/crowdsecConnectionSettings');
const { crowdsecConnectionSchema } = require('../domain/validation/crowdsecConnectionSchema');
const { isBlockedSsrfUrlResolved, ssrfBlockReason, plaintextCredentialWarning } = require('../integrations/http/internalUrlAllowlist');
const { CrowdsecLapiClient }       = require('../integrations/adapters/crowdsec/CrowdsecLapiClient');
const { RealHttpClient }           = require('../integrations/http/RealHttpClient');
const { classifyConnError }        = require('../integrations/http/connErrorClassifier');
const logger                       = require('../logger');

const router = Router();
const settingsRepo = createSettingsRepository();
const hostFromUrl = (url) => { try { return new URL(url).host; } catch { return ''; } };
const TEST_TIMEOUT_MS = 4000;

// Testbarer Probe-Seam: Default baut den echten LAPI-Client (RealHttpClient, geboundeter
// Timeout). Wird NIE über HTTP gesetzt — nur Tests injizieren via router.setProbeFactory()
// einen Fake-Client, um die ok/Fehler-Pfade ohne Netzwerk zu prüfen. null → Default zurück.
const defaultCrowdsecProbeFactory = ({ baseUrl, machineId, password, rejectUnauthorized }) =>
  new CrowdsecLapiClient({
    baseUrl, machineId, password,
    httpClient: new RealHttpClient({ timeout: TEST_TIMEOUT_MS, rejectUnauthorized, ssrfProtection: true }),
  });
let crowdsecProbeFactory = defaultCrowdsecProbeFactory;
router.setProbeFactory = (fn) => { crowdsecProbeFactory = fn || defaultCrowdsecProbeFactory; };

const connLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Versuche — bitte später erneut.' },
});

// GET /api/v1/crowdsec/connection
router.get('/connection', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedCrowdsecConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT /api/v1/crowdsec/connection — admin + Passwort-Step-up.
router.put('/connection', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  const actor = { actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '' };
  try {
    const { error, value } = crowdsecConnectionSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
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
        ...actor, action: AUDIT_ACTIONS.CROWDSEC_CONNECTION_CHANGE_DENIED,
        targetType: 'crowdsec_connection', targetId: 'crowdsec', metadata: { outcome: 'denied_invalid_password' },
      }).catch((e) => logger.error('crowdsec_conn_audit_failed', { error: e.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    try {
      await saveCrowdsecConnection(settingsRepo, {
        baseUrl: value.baseUrl, machineId: value.machineId, password: value.lapiPassword, tlsInsecure: value.tlsInsecure === true,
      });
    } catch (err) {
      if (err.code === 'CROWDSEC_INCOMPLETE') {
        return res.status(400).json({ error: 'CROWDSEC_INCOMPLETE', message: err.message, requestId: req.id });
      }
      throw err;
    }

    await auditService.write({
      ...actor, action: AUDIT_ACTIONS.CROWDSEC_CONNECTION_CHANGED,
      targetType: 'crowdsec_connection', targetId: 'crowdsec',
      metadata: { baseUrlSet: value.baseUrl !== '', machineIdSet: (value.machineId || '') !== '', passwordSet: (value.lapiPassword || '') !== '' },
    });

    res.json({ data: await maskedCrowdsecConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/crowdsec/connection/test — login gegen die LAPI (ohne Speichern).
router.post('/connection/test', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  try {
    const bodyUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
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
    const eff = await resolveCrowdsecConnection(settingsRepo, process.env);
    const targetChanged = bodyUrl !== '' && bodyUrl.replace(/\/+$/, '') !== String(eff.baseUrl || '').replace(/\/+$/, '');
    const hasBodyCredentials = typeof req.body?.machineId === 'string' && req.body.machineId.trim() !== ''
      && typeof req.body?.lapiPassword === 'string' && req.body.lapiPassword.trim() !== '';
    if (targetChanged && !hasBodyCredentials) {
      return res.status(400).json({ error: 'CREDENTIAL_TARGET_MISMATCH', message: 'Bei geaendertem Ziel muessen Machine-ID und Passwort neu angegeben werden.', requestId: req.id });
    }
    const baseUrl = bodyUrl !== '' ? bodyUrl : eff.baseUrl;
    const machineId = typeof req.body?.machineId === 'string' && req.body.machineId.trim() !== '' ? req.body.machineId.trim() : eff.machineId;
    const password = typeof req.body?.lapiPassword === 'string' && req.body.lapiPassword.trim() !== '' ? req.body.lapiPassword.trim() : eff.password;
    if (baseUrl && await isBlockedSsrfUrlResolved(baseUrl)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-URL nicht erlaubt (Loopback/Metadaten).', requestId: req.id });
    }
    if (!baseUrl || !machineId || !password) {
      return res.json({ data: { ok: false, reason: 'not_configured' }, requestId: req.id });
    }

    const rejectUnauthorized = !(req.body?.tlsInsecure === true || eff.tlsInsecure);
    const client = crowdsecProbeFactory({ baseUrl, machineId, password, rejectUnauthorized });
    const t0 = Date.now();
    let result;
    try {
      await client.login();
      result = { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      // Rohen Fehler nur serverseitig loggen; dem Client nur eine sichere Kategorie (kein Info-Disclosure).
      logger.warn('crowdsec_conn_test_probe_failed', { host: hostFromUrl(baseUrl), error: err.message });
      result = { ok: false, reason: 'error', error: classifyConnError(err), latencyMs: Date.now() - t0 };
    }
    // Non-blocking: warnt, wenn Creds unverschlüsselt (http) an ein externes Ziel gingen.
    const warning = plaintextCredentialWarning(baseUrl);
    if (warning) result.warning = warning;
    await auditService.write({
      actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '',
      action: AUDIT_ACTIONS.CROWDSEC_CONNECTION_TEST, targetType: 'crowdsec_connection', targetId: 'crowdsec',
      metadata: { host: hostFromUrl(baseUrl), ok: result.ok },
    }).catch((e) => logger.error('crowdsec_conn_test_audit_failed', { error: e.message }));

    res.json({ data: result, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
