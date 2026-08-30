'use strict';

const { Router } = require('express');
const { authService }                = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { requireAuth, requireRole }   = require('../middleware/authenticate');
const { mfaChallengeLimiter }        = require('../middleware/mfaRateLimit');
// Geteilte Cookie-Semantik (identisch für Passwort-, MFA- und SSO-Login).
const { setTokenCookie, setCsrfCookie, clearAuthCookies } = require('../http/authCookies');
const { buildAuthSessionResponse } = require('../http/authResponse');

const router = Router();

// POST /api/v1/auth/login
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body || {};
  const ip = req.ip || '';

  try {
    const result = await authService.login({ email, password, ip });

    // Aktive MFA → kein Session-Token, sondern kurzlebige Challenge (2. Faktor folgt).
    if (result.mfaRequired) {
      return res.json({ mfaRequired: true, challengeToken: result.challengeToken, requestId: req.id });
    }

    // Org-weite MFA-Pflicht, User hat noch keine MFA → kein Session-Token, sondern
    // ein Setup-Token. Der Client muss das Enrollment abschließen (/auth/mfa-setup/*).
    if (result.mfaSetupRequired) {
      return res.json({ mfaSetupRequired: true, setupToken: result.setupToken, requestId: req.id });
    }

    const { token, user } = result;
    await auditService.write({
      actorUserId: user.id,
      actorLabel:  user.email,
      action:      AUDIT_ACTIONS.LOGIN,
      ip,
    });

    // Browser-Session über httpOnly-Cookie; JSON-Token nur per Kompatibilitäts-Policy.
    setTokenCookie(res, token);
    setCsrfCookie(res);
    res.json(buildAuthSessionResponse({ token, user, requestId: req.id }));
  } catch (err) {
    // Fehlgeschlagene Logins ebenfalls loggen (kein User-Objekt verfügbar)
    await auditService.write({
      actorLabel: email || 'unknown',
      action:     AUDIT_ACTIONS.LOGIN_FAILED,
      // Generischer Grund im Audit (kein err.message → kein Detail-/PII-Leak);
      // der konkrete Fehler wird über next(err) serverseitig protokolliert.
      metadata:   { reason: 'login_failed' },
      ip,
    });
    next(err);
  }
});

// POST /api/v1/auth/mfa — 2. Faktor abschließen (Challenge + Code → Session-Token)
// Brute-Force-Schutz: pro Challenge-Token gekappt, nur Fehlversuche zählen.
router.post('/mfa', mfaChallengeLimiter, async (req, res, next) => {
  const { challengeToken, code } = req.body || {};
  const ip = req.ip || '';

  try {
    const { token, user } = await authService.completeMfaLogin({ challengeToken, code });

    await auditService.write({
      actorUserId: user.id,
      actorLabel:  user.email,
      action:      AUDIT_ACTIONS.LOGIN,
      metadata:    { mfa: true },
      ip,
    });

    setTokenCookie(res, token);
    setCsrfCookie(res);
    res.json(buildAuthSessionResponse({ token, user, requestId: req.id }));
  } catch (err) {
    // Audit-Reason bewusst generisch (nicht err.message-spezifisch): der konkrete
    // Grund (Challenge abgelaufen vs. falscher Code) darf nicht unterscheidbar
    // protokolliert werden. Der einheitliche 401 wird über next(err) ausgeliefert.
    await auditService.write({
      actorLabel: 'unknown',
      action:     AUDIT_ACTIONS.LOGIN_FAILED,
      metadata:   { reason: 'mfa_verification_failed', step: 'mfa' },
      ip,
    });
    next(err);
  }
});

// POST /api/v1/auth/mfa-setup/begin — erzwungenes Enrollment starten (Setup-Token → Secret/QR).
// Kein requireAuth: der Setup-Token (purpose:'mfa_setup') autorisiert NUR diesen Zweck.
router.post('/mfa-setup/begin', async (req, res, next) => {
  const { setupToken } = req.body || {};
  try {
    const result = await authService.beginMfaSetup({ setupToken });
    await auditService.write({
      actorUserId: result.userId,
      actorLabel:  result.email,
      action:      AUDIT_ACTIONS.MFA_ENROLL_STARTED,
      ip:          req.ip || '',
    });
    res.status(201).json({ secret: result.secret, otpauthUri: result.otpauthUri, enrollment: result.enrollment, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/mfa-setup/complete — Code bestätigt → MFA aktiv → volle Session.
router.post('/mfa-setup/complete', async (req, res, next) => {
  const { setupToken, code } = req.body || {};
  const ip = req.ip || '';
  try {
    const { token, user, recoveryCodes } = await authService.completeMfaSetup({ setupToken, code });
    await auditService.write({ actorUserId: user.id, actorLabel: user.email, action: AUDIT_ACTIONS.MFA_ENABLED, ip });
    await auditService.write({ actorUserId: user.id, actorLabel: user.email, action: AUDIT_ACTIONS.LOGIN, metadata: { mfa: true, viaSetup: true }, ip });
    setTokenCookie(res, token);
    setCsrfCookie(res);
    res.json(buildAuthSessionResponse({ token, user, recoveryCodes, requestId: req.id }));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  await authService.logout(req.userJti, req.userExp);

  await auditService.write({
    actorUserId: req.user.sub,
    actorLabel:  req.user.email,
    action:      AUDIT_ACTIONS.LOGOUT,
    ip:          req.ip,
  });

  // httpOnly-Cookie + CSRF-Cookie löschen (Cookie-Pfad-Logout).
  clearAuthCookies(res);
  res.json({ message: 'Logged out', requestId: req.id });
});

// GET /api/v1/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    // req.user ist bereits durch requireAuth verifiziert — direkt per sub laden,
    // kein erneutes Token-Parsing/Verify (vermeidet divergente Auth-Pfade).
    const user = await authService.getUserById(req.user.sub);
    // CSRF-Cookie bei jedem App-Load auffrischen (auch für Bestands-Sessions).
    setCsrfCookie(res);
    res.json({ data: user, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/change-password — eigenes Passwort ändern (auth)
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    await authService.changePassword({ userId: req.user.sub, currentPassword, newPassword });
    await auditService.write({
      actorUserId: req.user.sub,
      actorLabel:  req.user.email,
      action:      'auth.password_change',
      ip:          req.ip,
    });
    res.json({ ok: true, message: 'Passwort geändert', requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// P_CORR_ADMIN_2 Stufe 2 — frische Re-Authentifizierung für den Apply-Kanal.
// Prüft das Passwort des eingeloggten Users erneut und gibt einen kurzlebigen,
// zweckgebundenen apply_reauth-Token (KEIN Session-Token) zurück.
router.post('/reauth', requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    const out = await authService.issueApplyReauth({ email: req.user.email, password });
    await auditService.write({ actorUserId: req.user.sub, actorLabel: req.user.email, action: 'auth.reauth', ip: req.ip });
    res.json({ data: { reauthToken: out.token, expiresIn: out.expiresIn }, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// Deployment Center (ADR-041) — frische Re-Authentifizierung für den Infra-Deploy.
// Gibt einen zweckgebundenen deploy_reauth-Token zurück (KEIN Session-Token,
// NICHT als apply_reauth gültig).
router.post('/deploy-reauth', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    const out = await authService.issueDeployReauth({ email: req.user.email, password });
    await auditService.write({ actorUserId: req.user.sub, actorLabel: req.user.email, action: 'auth.deploy_reauth', ip: req.ip });
    res.json({ data: { reauthToken: out.token, expiresIn: out.expiresIn }, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
