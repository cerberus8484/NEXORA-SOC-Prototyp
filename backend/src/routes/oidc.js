'use strict';

/**
 * Route /api/v1/auth/oidc — SSO-Login (OpenID Connect, Authorization Code + PKCE).
 *
 * Hard-Gate: OIDC_ENABLED!=true → /login + /callback geben 503 (default inert).
 * /status ist immer erreichbar (liefert nur das Boolean, kein Secret), damit das
 * Frontend den SSO-Button korrekt ein-/ausblenden kann.
 *
 * SICHERHEIT:
 *   - Flow-Zustand (state/nonce/codeVerifier) steckt in einem KURZLEBIGEN, signierten
 *     httpOnly-Cookie (purpose:'oidc_flow') — kein Server-State, fälschungssicher.
 *   - Flow-Cookie sameSite=lax (NICHT strict): der Callback ist eine Top-Level-
 *     Navigation vom IdP zurück; bei strict käme der Cookie nicht mit. state bleibt
 *     die eigentliche CSRF-Bindung; lax verhindert weiter Cross-Site-POST-Leaks.
 *   - Redirect-Ziele sind FEST und intern (kein Open-Redirect über User-Parameter).
 *   - Der konkrete Fehlergrund wird nur serverseitig geloggt; der Client sieht nur
 *     einen generischen ?sso_error=1.
 */

const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { readCookie } = require('../http/authCookies');

const FLOW_COOKIE     = 'oidc_flow';
const FLOW_TTL        = '10m';
const FLOW_MAX_AGE_MS = 10 * 60 * 1000;
// Feste interne Ziele — NIE aus Request-Parametern (Open-Redirect-Schutz).
const LOGIN_PATH      = '/login';
const POST_LOGIN_PATH = '/';

/**
 * Baut den OIDC-Router mit injizierten Abhängigkeiten (testbar ohne Netz/jose).
 *
 * @param {object} deps
 * @param {object} deps.oidcService — beginLogin()/completeLogin()
 * @param {object} deps.config — config (liest config.oidc.enabled)
 * @param {object} deps.logger
 * @param {object} deps.auditService
 * @param {object} deps.AUDIT_ACTIONS
 * @param {string} deps.jwtSecret — zum Signieren/Prüfen des Flow-Cookies
 * @param {Function} deps.setTokenCookie
 * @param {Function} deps.setCsrfCookie
 * @returns {import('express').Router}
 */
function createOidcRouter({ oidcService, config, getEnabled, logger, auditService, AUDIT_ACTIONS, jwtSecret, setTokenCookie, setCsrfCookie }) {
  const router = Router();

  // `enabled` kommt im Prod-Betrieb aus der effektiven DB-Config (In-UI-Admin,
  // getEnabled); fehlt der Resolver (Tests/Legacy), gilt das statische config-Flag.
  async function isOidcEnabled() {
    if (getEnabled) return Boolean(await getEnabled());
    return config?.oidc?.enabled === true;
  }

  async function oidcEnabledGuard(req, res, next) {
    try {
      if (!(await isOidcEnabled())) return res.status(503).json({ error: 'OIDC_DISABLED' });
      next();
    } catch (err) {
      logger.error('oidc_enabled_check_failed', { message: err.message });
      res.status(503).json({ error: 'OIDC_DISABLED' });
    }
  }

  function setFlowCookie(res, flow) {
    const token = jwt.sign({ ...flow, purpose: 'oidc_flow' }, jwtSecret, { expiresIn: FLOW_TTL });
    res.cookie(FLOW_COOKIE, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   FLOW_MAX_AGE_MS,
    });
  }

  // GET /status — öffentlich; nur ob SSO aktiv ist (kein Secret, kein Gate).
  router.get('/status', async (req, res) => {
    try {
      res.json({ enabled: await isOidcEnabled() });
    } catch {
      res.json({ enabled: false });
    }
  });

  // GET /login — Flow starten, 302 zum IdP.
  router.get('/login', oidcEnabledGuard, async (req, res) => {
    try {
      const { authorizationUrl, flow } = await oidcService.beginLogin();
      setFlowCookie(res, flow);
      res.redirect(302, authorizationUrl);
    } catch (err) {
      logger.error('oidc_login_start_failed', { message: err.message });
      res.redirect(302, `${LOGIN_PATH}?sso_error=1`);
    }
  });

  // GET /callback — IdP-Rücksprung: Flow-Cookie verbrauchen → Token tauschen → Session.
  router.get('/callback', oidcEnabledGuard, async (req, res) => {
    const ip = req.ip || '';

    // Flow-Cookie lesen UND sofort löschen (one-time use, egal ob gültig).
    let flow = null;
    const raw = readCookie(req.headers.cookie, FLOW_COOKIE);
    res.clearCookie(FLOW_COOKIE, { httpOnly: true, sameSite: 'lax' });
    if (raw) {
      try {
        const p = jwt.verify(raw, jwtSecret);
        if (p.purpose === 'oidc_flow') {
          flow = { state: p.state, nonce: p.nonce, codeVerifier: p.codeVerifier };
        }
      } catch { /* abgelaufen/ungültig → flow bleibt null → completeLogin lehnt ab */ }
    }

    try {
      const { session, userId, email, linkMode } = await oidcService.completeLogin({
        code:          req.query.code,
        returnedState: req.query.state,
        flow:          flow || {},
      });
      setTokenCookie(res, session.token);
      setCsrfCookie(res);
      await auditService.write({
        actorUserId: userId, actorLabel: email,
        action: AUDIT_ACTIONS.LOGIN, metadata: { sso: true, linkMode }, ip,
      });
      res.redirect(302, POST_LOGIN_PATH);
    } catch (err) {
      const reason = err && err.reason ? err.reason : 'sso_failed';
      logger.warn('oidc_callback_failed', { reason });
      await auditService.write({
        actorLabel: 'unknown', action: AUDIT_ACTIONS.LOGIN_FAILED,
        metadata: { reason: 'sso_failed' }, ip,
      });
      res.redirect(302, `${LOGIN_PATH}?sso_error=1`);
    }
  });

  return router;
}

// ── Default-Export: verdrahtet die echten Singletons ──────────────────────────
const config = require('../config');
const logger = require('../logger');
const { JWT_SECRET } = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { setTokenCookie, setCsrfCookie } = require('../http/authCookies');
const { oidcService, settingsRepo } = require('../auth/oidc/oidcInstance');
const { getEffectiveOidcConfig } = require('../auth/oidc/oidcConfigService');

const router = createOidcRouter({
  oidcService, config, logger, auditService, AUDIT_ACTIONS,
  // enabled dynamisch aus der effektiven DB-Config (In-UI-Admin) mit ENV-Fallback.
  getEnabled: async () => (await getEffectiveOidcConfig(settingsRepo)).enabled,
  jwtSecret: JWT_SECRET, setTokenCookie, setCsrfCookie,
});

module.exports = router;
module.exports.createOidcRouter = createOidcRouter;
