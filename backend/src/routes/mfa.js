'use strict';

// ── Route /api/v1/mfa — Multi-Factor-Authentication (TOTP, Security-Welle 3) ──
//
// Hard-Gate: MFA_ENABLED=false → alle Endpunkte geben 503 zurück (default inert).
//
// SICHERHEIT:
//   - Secret + Recovery-Codes verlassen den Server nur EINMALIG (enroll/verify)
//   - self-only: req.user.sub isoliert jeden Zugriff auf den eigenen Account
//   - disable bei aktiver MFA erfordert gültigen Code (kein Abschalten per Session-Hijack)
//   - Audit speichert NUR sichere Metadaten — nie Secret, Code oder Recovery-Code

const { Router }          = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { mfaUserLimiter }  = require('../middleware/mfaRateLimit');
const { mfaService }      = require('../services/MfaService');
const { authService }     = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { ValidationError } = require('../errors/AppError');
const config              = require('../config');
const logger              = require('../logger');

const router = Router();

function mfaEnabledGuard(req, res, next) {
  if (!config.mfa.enabled) {
    return res.status(503).json({ error: 'MFA_DISABLED' });
  }
  next();
}

function actor(req) {
  return { userId: req.user.sub || req.user.id, label: req.user.email || req.user.sub };
}

// ── POST /api/v1/mfa/enroll ───────────────────────────────────────────────────
// Startet das Enrollment. Response: { secret (EINMALIG), otpauthUri, enrollment }
router.post('/enroll', mfaEnabledGuard, requireAuth, async (req, res, next) => {
  try {
    const { userId, label } = actor(req);
    let result;
    try {
      result = await mfaService.beginEnrollment(userId, { issuer: 'Nexora SOC', label });
    } catch (err) {
      return next(new ValidationError(err.message)); // z.B. bereits aktiv
    }

    await auditService.write({
      actorUserId: userId,
      actorLabel:  label,
      action:      AUDIT_ACTIONS.MFA_ENROLL_STARTED,
      ip:          req.ip,
    });

    res.status(201).json({
      secret:     result.secret,
      otpauthUri: result.otpauthUri,
      enrollment: result.enrollment,
      requestId:  req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/mfa/verify ───────────────────────────────────────────────────
// Verifiziert den ersten TOTP-Code, aktiviert MFA. Response: { recoveryCodes (EINMALIG) }
// Brute-Force-Schutz (mfaUserLimiter) NACH requireAuth — Schlüssel ist req.user.sub.
router.post('/verify', mfaEnabledGuard, requireAuth, mfaUserLimiter, async (req, res, next) => {
  try {
    const { userId, label } = actor(req);
    const { token } = req.body || {};

    let result;
    try {
      result = await mfaService.activate(userId, token);
    } catch (err) {
      return next(new ValidationError(err.message)); // ungültiger Code / kein Enrollment
    }

    await auditService.write({
      actorUserId: userId,
      actorLabel:  label,
      action:      AUDIT_ACTIONS.MFA_ENABLED,
      ip:          req.ip,
    });

    res.json({
      recoveryCodes: result.recoveryCodes,
      enrollment:    result.enrollment,
      requestId:     req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/mfa/disable ──────────────────────────────────────────────────
// Deaktiviert MFA. Bei aktiver MFA ist ein gültiger Code (TOTP oder Recovery) Pflicht.
// Brute-Force-Schutz (mfaUserLimiter) NACH requireAuth — der Disable-Code ist kappbar.
router.post('/disable', mfaEnabledGuard, requireAuth, mfaUserLimiter, async (req, res, next) => {
  try {
    const { userId, label } = actor(req);
    const status = await mfaService.getStatus(userId);

    if (status.status === 'active') {
      const ok = await mfaService.verify(userId, (req.body || {}).code);
      if (!ok) {
        return next(new ValidationError('Gültiger Code erforderlich, um MFA zu deaktivieren'));
      }
    }

    await mfaService.disable(userId);

    await auditService.write({
      actorUserId: userId,
      actorLabel:  label,
      action:      AUDIT_ACTIONS.MFA_DISABLED,
      ip:          req.ip,
    });

    res.json({ status: 'disabled', requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/v1/mfa/status ────────────────────────────────────────────────────
// Eigener MFA-Status (ohne Secret/Hashes).
router.get('/status', mfaEnabledGuard, requireAuth, async (req, res, next) => {
  try {
    const { userId } = actor(req);
    const status = await mfaService.getStatus(userId);
    res.json({ ...status, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/mfa/admin/reset — Admin setzt MFA eines ausgesperrten Users zurück ─
// Schließt die Lock-in-Lücke (Behavioral-Bug #1): verliert ein User seinen Authenticator,
// gibt es sonst KEINEN Weg zurück (Self-Disable braucht einen gültigen Code).
//
// BEWUSST NICHT hinter mfaEnabledGuard: der Recovery-Weg muss gerade dann greifen, wenn
// MFA org-weit abgeschaltet wird — sonst 503-Sackgasse. Admin-only + Passwort-Step-up
// (Admin bestätigt EIGENES Passwort) + Audit (Actor=Admin, Target=User; nie Secret).
router.post('/admin/reset', requireAuth, requireRole('admin'), async (req, res, next) => {
  const adminId    = req.user.sub || req.user.id;
  const adminLabel = req.user.email || adminId;
  try {
    const { userId, password } = req.body || {};
    if (!userId)   return res.status(400).json({ error: 'user_required', message: 'userId erforderlich.', requestId: req.id });
    if (!password) return res.status(400).json({ error: 'password_required', message: 'Passwort erforderlich.', requestId: req.id });

    // Ziel-User muss existieren (kein stiller No-op / Enumeration-neutral: 404).
    const target = await authService._findById(userId);
    if (!target) return res.status(404).json({ error: 'not_found', message: 'Nutzer nicht gefunden.', requestId: req.id });

    // Passwort-Step-up gegen den AKTUELLEN Admin (fail-closed).
    const admin = await authService._findById(adminId);
    const valid = admin && admin.passwordHash ? await authService.verifyPassword(password, admin.passwordHash) : false;
    if (!valid) {
      await auditService.write({
        actorUserId: adminId, actorLabel: adminLabel,
        action: AUDIT_ACTIONS.MFA_ADMIN_RESET_DENIED,
        targetType: 'user', targetId: userId, metadata: { outcome: 'denied_invalid_password' }, ip: req.ip,
      }).catch((e) => logger.error('mfa_admin_reset_audit_failed', { error: e.message }));
      return res.status(403).json({ error: 'invalid_password', message: 'Passwort ungültig.', requestId: req.id });
    }

    await mfaService.disable(userId);

    await auditService.write({
      actorUserId: adminId, actorLabel: adminLabel,
      action: AUDIT_ACTIONS.MFA_ADMIN_RESET,
      targetType: 'user', targetId: userId, metadata: { outcome: 'reset' }, ip: req.ip,
    });

    res.json({ status: 'disabled', userId, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
