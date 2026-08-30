'use strict';

/**
 * Route /api/v1/auth/webauthn — Passkey/FIDO2-Login + -Verwaltung.
 *
 * Hard-Gate: WEBAUTHN_ENABLED!=true → alle Ceremony-Routen 503 (default inert).
 * /status ist immer erreichbar (nur Boolean), damit das Frontend den Passkey-
 * Button korrekt ein-/ausblendet.
 *
 * SICHERHEIT:
 *   - Ceremony-Zustand (challenge[, userId]) steckt in einem KURZLEBIGEN, signierten
 *     httpOnly-Cookie (purpose:'webauthn_flow', sameSite=strict — same-origin-AJAX,
 *     kein IdP-Rücksprung wie bei OIDC) → kein Server-State, one-time-use.
 *   - register/* sind requireAuth (Enrollment im eingeloggten Zustand); der Flow-
 *     Cookie bindet zusätzlich an genau diesen User (flow.userId === req.user.sub).
 *   - login/* sind pre-session (kein soc_token) → csrfGuard greift nicht.
 *   - finishAuthentication liefert einen einheitlichen 401 (kein Grund-Leak).
 */

const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { readCookie } = require('../http/authCookies');

const FLOW_COOKIE     = 'webauthn_flow';
const FLOW_TTL        = '5m';
const FLOW_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Baut den WebAuthn-Router mit injizierten Abhängigkeiten (testbar ohne Lib/Netz).
 *
 * @param {object} deps
 * @param {object} deps.webAuthnService — begin/finishRegistration + begin/finishAuthentication
 * @param {object} deps.credentialRepo — findByUserId/deleteById (Verwaltung)
 * @param {object} deps.config — liest config.webauthn.enabled
 * @param {object} deps.logger
 * @param {string} deps.jwtSecret — signiert/prüft den Flow-Cookie
 * @param {Function} deps.requireAuth — Auth-Middleware
 * @param {Function} deps.setTokenCookie
 * @param {Function} deps.setCsrfCookie
 * @returns {import('express').Router}
 */
function createWebauthnRouter({ webAuthnService, credentialRepo, config, logger, jwtSecret, requireAuth, setTokenCookie, setCsrfCookie }) {
  const router = Router();

  function gate(req, res, next) {
    if (!config.webauthn.enabled) return res.status(503).json({ error: 'WEBAUTHN_DISABLED', requestId: req.id });
    next();
  }

  function setFlowCookie(res, flow) {
    const token = jwt.sign({ ...flow, purpose: 'webauthn_flow' }, jwtSecret, { expiresIn: FLOW_TTL });
    res.cookie(FLOW_COOKIE, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   FLOW_MAX_AGE_MS,
    });
  }

  // Flow-Cookie lesen UND sofort löschen (one-time use, egal ob gültig).
  function consumeFlow(req, res) {
    const raw = readCookie(req.headers.cookie, FLOW_COOKIE);
    res.clearCookie(FLOW_COOKIE, { httpOnly: true, sameSite: 'strict' });
    if (!raw) return null;
    try {
      const p = jwt.verify(raw, jwtSecret);
      return p.purpose === 'webauthn_flow' ? p : null;
    } catch {
      return null;
    }
  }

  // GET /status — öffentlich, nur ob Passkeys aktiv sind (kein Secret, kein Gate).
  router.get('/status', (req, res) => {
    res.json({ enabled: config.webauthn.enabled === true });
  });

  // ── Registrierung (eingeloggter User) ──────────────────────────────────────
  router.post('/register/options', requireAuth, gate, async (req, res, next) => {
    try {
      const { options, flow } = await webAuthnService.beginRegistration({ id: req.user.sub, email: req.user.email });
      setFlowCookie(res, flow);
      res.json({ options, requestId: req.id });
    } catch (err) { next(err); }
  });

  router.post('/register/verify', requireAuth, gate, async (req, res, next) => {
    try {
      const flow = consumeFlow(req, res);
      if (!flow || flow.userId !== req.user.sub) {
        return res.status(400).json({ error: 'webauthn_flow_invalid', requestId: req.id });
      }
      const credential = await webAuthnService.finishRegistration({
        flow, response: req.body?.response, label: req.body?.label,
      });
      res.status(201).json({ data: credential, requestId: req.id });
    } catch (err) { next(err); }
  });

  // ── Anmeldung (usernamelos, pre-session) ───────────────────────────────────
  router.post('/login/options', gate, async (req, res, next) => {
    try {
      const { options, flow } = await webAuthnService.beginAuthentication();
      setFlowCookie(res, flow);
      res.json({ options, requestId: req.id });
    } catch (err) { next(err); }
  });

  router.post('/login/verify', gate, async (req, res) => {
    const flow = consumeFlow(req, res);
    try {
      if (!flow) return res.status(401).json({ error: 'webauthn_failed', requestId: req.id });
      const { token, user } = await webAuthnService.finishAuthentication({ flow, response: req.body?.response });
      setTokenCookie(res, token);
      setCsrfCookie(res);
      res.json({ user, requestId: req.id });
    } catch (err) {
      // WebAuthnError → einheitlicher 401 (kein Grund-Leak). Unerwartetes → 500.
      if (err && err.name === 'WebAuthnError') {
        return res.status(401).json({ error: 'webauthn_failed', requestId: req.id });
      }
      logger.error('webauthn_login_error', { message: err.message });
      res.status(500).json({ error: 'internal_error', requestId: req.id });
    }
  });

  // ── Credential-Verwaltung (eigene Passkeys) ────────────────────────────────
  router.get('/credentials', requireAuth, async (req, res, next) => {
    try {
      const creds = await credentialRepo.findByUserId(req.user.sub);
      res.json({ data: creds.map((c) => c.toPublicJSON()), requestId: req.id });
    } catch (err) { next(err); }
  });

  router.delete('/credentials/:id', requireAuth, async (req, res, next) => {
    try {
      const ok = await credentialRepo.deleteById(req.params.id, req.user.sub);
      if (!ok) return res.status(404).json({ error: 'not_found', requestId: req.id });
      res.json({ ok: true, requestId: req.id });
    } catch (err) { next(err); }
  });

  return router;
}

// ── Default-Export: verdrahtet die echten Singletons ──────────────────────────
const config = require('../config');
const logger = require('../logger');
const { JWT_SECRET } = require('../services/AuthService');
const { requireAuth } = require('../middleware/authenticate');
const { setTokenCookie, setCsrfCookie } = require('../http/authCookies');
const { webAuthnService, credentialRepo } = require('../auth/webauthn/webAuthnInstance');

const router = createWebauthnRouter({
  webAuthnService, credentialRepo, config, logger,
  jwtSecret: JWT_SECRET, requireAuth, setTokenCookie, setCsrfCookie,
});

module.exports = router;
module.exports.createWebauthnRouter = createWebauthnRouter;
