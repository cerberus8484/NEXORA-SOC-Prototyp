'use strict';

// ── Route /api/v1/imap — IMAP-Postfach-Verbindung (Layer 2, admin) ────────────
//
// GET  /connection       — maskiert (nie das Passwort)
// PUT  /connection       — speichern (admin + Passwort-Step-up + Audit)
// POST /connection/test  — Verbindungstest (connect+login), ohne Speichern
//
// Kein Applier: der ImapPoller löst die Verbindung pro Zyklus aus DB > ENV auf
// → eine Änderung greift beim nächsten Poll-Lauf (≤ Poll-Intervall), ohne Neustart.
//
// SSRF: IMAP ist eine rohe TCP-Verbindung (kein HTTP-URL), daher greift die
// HTTP-URL-Allowlist nicht. Als Defense-in-Depth (der Endpoint ist admin + Step-up)
// blocken wir Cloud-Metadaten-/Link-local-Hosts explizit.

const { Router } = require('express');
const rateLimit  = require('express-rate-limit');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { authService }              = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { createSettingsRepository } = require('../repositories/settingsRepositoryFactory');
const { resolveImapConnection, saveImapConnection, maskedImapConnection } = require('../services/imapConnectionSettings');
const { imapConnectionSchema }     = require('../domain/validation/imapConnectionSchema');
const { testImapConnection } = require('../integrations/adapters/email/imapConnectionTester');
const { isBlockedSsrfHostResolved } = require('../integrations/http/internalUrlAllowlist');
const logger                       = require('../logger');

const router = Router();
const settingsRepo = createSettingsRepository();

// SSRF-Defense-in-Depth: rohes TCP (kein HTTP-URL), daher die geteilte host-basierte
// Deny-List — Loopback, Link-local, Cloud-Metadaten, 0.0.0.0, localhost. Der /test-
// Endpoint ist admin-only aber ohne Step-up, also nie ein Connect-Primitiv gegen
// interne Sonderbereiche zulassen.

const connLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.sub || 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'rate_limited', message: 'Zu viele Versuche — bitte später erneut.' },
});

// GET /api/v1/imap/connection
router.get('/connection', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    res.json({ data: await maskedImapConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// PUT /api/v1/imap/connection — admin + Passwort-Step-up.
router.put('/connection', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  const actor = { actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '' };
  try {
    const { error, value } = imapConnectionSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/['"]/g, '') }));
      return res.status(400).json({ error: 'VALIDATION_ERROR', details, requestId: req.id });
    }
    if (value.host && await isBlockedSsrfHostResolved(value.host)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-Host nicht erlaubt (Loopback/Link-local/Metadaten).', requestId: req.id });
    }

    const admin = await authService._findById(req.user?.sub);
    const valid = admin && admin.passwordHash ? await authService.verifyPassword(value.password, admin.passwordHash) : false;
    if (!valid) {
      await auditService.write({
        ...actor, action: AUDIT_ACTIONS.IMAP_CONNECTION_CHANGE_DENIED,
        targetType: 'imap_connection', targetId: 'imap', metadata: { outcome: 'denied_invalid_password' },
      }).catch((e) => logger.error('imap_conn_audit_failed', { error: e.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    try {
      await saveImapConnection(settingsRepo, {
        host: value.host, port: value.port, user: value.user, password: value.imapPassword, secure: value.secure,
      });
    } catch (err) {
      if (err.code === 'IMAP_INCOMPLETE') {
        return res.status(400).json({ error: 'IMAP_INCOMPLETE', message: err.message, requestId: req.id });
      }
      throw err;
    }

    await auditService.write({
      ...actor, action: AUDIT_ACTIONS.IMAP_CONNECTION_CHANGED,
      targetType: 'imap_connection', targetId: 'imap',
      metadata: { hostSet: (value.host || '') !== '', userSet: (value.user || '') !== '', passwordSet: (value.imapPassword || '') !== '' },
    });

    res.json({ data: await maskedImapConnection(settingsRepo), requestId: req.id });
  } catch (err) { next(err); }
});

// POST /api/v1/imap/connection/test — connect+login gegen das Postfach (ohne Speichern).
router.post('/connection/test', requireAuth, requireRole('admin'), connLimiter, async (req, res, next) => {
  try {
    const bodyHost = typeof req.body?.host === 'string' ? req.body.host.trim() : '';
    if (bodyHost !== '' && await isBlockedSsrfHostResolved(bodyHost)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-Host nicht erlaubt (Loopback/Link-local/Metadaten).', requestId: req.id });
    }
    const eff = await resolveImapConnection(settingsRepo, process.env);
    const targetChanged = bodyHost !== '' && bodyHost.toLowerCase() !== String(eff.host || '').toLowerCase();
    const hasBodyCredentials = typeof req.body?.user === 'string' && req.body.user.trim() !== ''
      && typeof req.body?.imapPassword === 'string' && req.body.imapPassword.trim() !== '';
    if (targetChanged && !hasBodyCredentials) {
      return res.status(400).json({ error: 'CREDENTIAL_TARGET_MISMATCH', message: 'Bei geaendertem Ziel muessen Benutzername und Passwort neu angegeben werden.', requestId: req.id });
    }
    const host = bodyHost !== '' ? bodyHost : eff.host;
    const port = Number(req.body?.port) || eff.port;
    const user = typeof req.body?.user === 'string' && req.body.user.trim() !== '' ? req.body.user.trim() : eff.user;
    const password = typeof req.body?.imapPassword === 'string' && req.body.imapPassword.trim() !== '' ? req.body.imapPassword.trim() : eff.password;
    const secure = typeof req.body?.secure === 'boolean' ? req.body.secure : eff.secure;
    if (host && await isBlockedSsrfHostResolved(host)) {
      return res.status(400).json({ error: 'BLOCKED_URL', message: 'Ziel-Host nicht erlaubt (Loopback/Link-local/Metadaten).', requestId: req.id });
    }
    if (!host || !user || !password) {
      return res.json({ data: { ok: false, reason: 'not_configured' }, requestId: req.id });
    }

    const result = await testImapConnection({ host, port, user, password, secure });
    await auditService.write({
      actorUserId: req.user?.sub ?? null, actorLabel: req.user?.email ?? 'unknown', ip: req.ip || '',
      action: AUDIT_ACTIONS.IMAP_CONNECTION_TEST, targetType: 'imap_connection', targetId: 'imap',
      metadata: { host, ok: result.ok },
    }).catch((e) => logger.error('imap_conn_test_audit_failed', { error: e.message }));

    res.json({ data: result, requestId: req.id });
  } catch (err) { next(err); }
});

module.exports = router;
