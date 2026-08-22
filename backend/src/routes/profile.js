'use strict';

// Profil-Self-Service — NUR eigene unkritische Felder: displayName, phone, theme.
// role / email / isActive / passwordHash sind über diesen Pfad NICHT änderbar (Security-Prinzip).
//
// GET  /api/v1/profile  — eigenes User-Public-Objekt
// PUT  /api/v1/profile  — displayName?, phone?, theme? (Joi-validiert, stripUnknown)

const { Router }  = require('express');
const Joi         = require('joi');

const { requireAuth }                           = require('../middleware/authenticate');
const { authService }                           = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS }           = require('../services/AuditService');
const { ValidationError, UnauthorizedError }    = require('../errors/AppError');
const config                                    = require('../config');

const router = Router();

// Erlaubte theme-Werte — explizite Allowlist, kein freier String.
// 'system' = der OS-Präferenz (prefers-color-scheme) folgen; Auflösung im Frontend.
const THEME_VALUES = ['dark', 'light', 'system', ''];

// Erlaubte Sprach- + Datumsformat-Werte — explizite Allowlists.
const LANGUAGE_VALUES    = ['de', 'en'];
const DATE_FORMAT_VALUES = ['dmy', 'iso'];

const updateProfileSchema = Joi.object({
  displayName: Joi.string().max(200).allow('').optional(),
  phone:       Joi.string().max(50).allow('').optional(),
  theme:       Joi.string().valid(...THEME_VALUES).optional(),
  language:    Joi.string().valid(...LANGUAGE_VALUES).optional(),
  dateFormat:  Joi.string().valid(...DATE_FORMAT_VALUES).optional(),
}).options({ stripUnknown: true }); // role/email/isActive/passwordHash werden still entfernt

// ── GET /api/v1/profile ──────────────────────────────────────────────────────
// Gibt das Public-Objekt des eingeloggten Users zurück (kein passwordHash).
// Lädt frisch aus dem Repo (nicht aus JWT-Claims) damit phone/theme aktuell sind.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    // _findById lädt die vollständige User-Instanz (inkl. phone/theme);
    // getUserById gibt bereits toPublicJSON() zurück — wir brauchen die Instanz.
    const user = await authService._users.findById(req.user.sub);
    if (!user || !user.isActive) {
      return next(new UnauthorizedError('Benutzer nicht gefunden'));
    }
    // Per-User-Feature-Flags: damit die ProfilePage MFA/PAT-Selbstverwaltung für
    // ALLE Rollen korrekt gaten kann (die Settings-Tabs sind admin-only — diese
    // pro-User-Features gehören aufs Profil, nicht hinter ein Admin-Gate).
    res.json({
      data: user.toPublicJSON(),
      features: {
        mfaEnabled:       config.mfa.enabled,
        apiTokensEnabled: config.apiTokens.enabled,
      },
      requestId: req.id,
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/v1/profile ──────────────────────────────────────────────────────
// Aktualisiert AUSSCHLIESSLICH displayName, phone, theme des eingeloggten Users.
// Jeder Versuch, role/email/isActive/passwordHash zu setzen, wird durch
// Joi stripUnknown + updateProfile()-Scope auf Repo-Ebene doppelt geblockt.
router.put('/', requireAuth, async (req, res, next) => {
  try {
    const { error, value } = updateProfileSchema.validate(req.body || {});
    if (error) {
      return next(new ValidationError(error.details[0].message));
    }

    // updateProfile() im Repo setzt NUR die drei erlaubten Felder.
    const updated = await authService._users.updateProfile(req.user.sub, value);

    if (!updated) {
      // Sollte nicht passieren (Token wäre ungültig), aber defensiv abfangen.
      return next(new ValidationError('User nicht gefunden'));
    }

    await auditService.write({
      actorUserId: req.user.sub,
      actorLabel:  req.user.email,
      action:      AUDIT_ACTIONS.PROFILE_UPDATED,
      targetType:  'user',
      targetId:    req.user.sub,
      ip:          req.ip,
    });

    res.json({ data: updated.toPublicJSON(), requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
