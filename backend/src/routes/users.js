'use strict';

const { Router } = require('express');
const bcrypt     = require('bcrypt');
const { randomUUID } = require('crypto');
const { User, ROLES }                = require('../domain/User');
const { UserService }                = require('../services/UserService');
const { authService, resolveBcryptRounds } = require('../services/AuthService');
const { auditService, AUDIT_ACTIONS } = require('../services/AuditService');
const { requireAuth, requireRole }   = require('../middleware/authenticate');
const { ValidationError }            = require('../errors/AppError');
const { validatePassword }           = require('../domain/passwordPolicy');
const { loadPasswordPolicy }         = require('../domain/passwordPolicyLoader');

// Kostenstufe aus ENV (BCRYPT_ROUNDS), Prod-Floor ≥12, test=4 — zentral in AuthService.
const BCRYPT_ROUNDS = resolveBcryptRounds({ rounds: process.env.BCRYPT_ROUNDS, nodeEnv: process.env.NODE_ENV });

const router = Router();

// Teilt sich das UserRepository mit dem AuthService-Singleton
// (Postgres bei DB_ENABLED, sonst InMemory) — kein zweiter Datenspeicher.
const userService = new UserService(authService._users);

// Alle Benutzer-Routen: eingeloggt + Admin.
router.use(requireAuth, requireRole('admin'));

// GET /api/v1/users — Liste aller Benutzer (ohne passwordHash)
router.get('/', async (req, res, next) => {
  try {
    const users = await userService.listUsers();
    res.json({ data: users, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/:id/role — Rolle ändern
router.patch('/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body || {};
    const user = await userService.setRole({
      targetUserId: req.params.id,
      role,
      actingUserId: req.user.sub,
    });
    await auditService.write({
      actorUserId: req.user.sub,
      actorLabel:  req.user.email,
      action:      AUDIT_ACTIONS.USER_ROLE_CHANGE,
      targetType:  'user',
      targetId:    user.id,
      metadata:    { role: user.role },
      ip:          req.ip,
    });
    res.json({ data: user, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/:id/active — Account aktivieren/deaktivieren
router.patch('/:id/active', async (req, res, next) => {
  try {
    const { isActive } = req.body || {};
    const user = await userService.setActive({
      targetUserId: req.params.id,
      isActive,
      actingUserId: req.user.sub,
    });
    await auditService.write({
      actorUserId: req.user.sub,
      actorLabel:  req.user.email,
      action:      AUDIT_ACTIONS.USER_ACTIVE_CHANGE,
      targetType:  'user',
      targetId:    user.id,
      metadata:    { isActive: user.isActive },
      ip:          req.ip,
    });
    res.json({ data: user, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/:id/reset-password — Passwort zurücksetzen (admin only)
// Erzeugt ein sicheres temporäres Passwort, setzt dessen Hash auf den Ziel-User
// und gibt das Klartext-PW NUR in dieser Response zurück (nie ins Log/Audit).
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const { user, tempPassword } = await userService.resetPassword(req.params.id);
    await auditService.write({
      actorUserId: req.user.sub,
      actorLabel:  req.user.email,
      action:      AUDIT_ACTIONS.USER_PASSWORD_RESET,
      targetType:  'user',
      targetId:    user.id,
      metadata:    { email: user.email },   // KEIN Passwort/Hash ins Audit-Log
      ip:          req.ip,
    });
    res.json({ data: { tempPassword }, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users — Neuen Benutzer anlegen (admin only)
router.post('/', async (req, res, next) => {
  try {
    const { email, password, role = 'analyst' } = req.body || {};

    // Eingabe-Validierung
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new ValidationError('E-Mail ist ungültig oder fehlt');
    }
    if (!password || typeof password !== 'string') {
      throw new ValidationError('Passwort fehlt oder ist kein gültiger String');
    }
    if (!ROLES.includes(role)) {
      throw new ValidationError(`Unbekannte Rolle '${role}' — erlaubt: ${ROLES.join(', ')}`);
    }

    // Policy serverseitig laden und durchsetzen — gilt NUR für neue Passwörter.
    const policy = await loadPasswordPolicy();
    const { ok: policyOk, errors: policyErrors } = validatePassword(password, policy);
    if (!policyOk) throw new ValidationError(policyErrors.join('; '));

    // Doppelte E-Mail prüfen
    const existing = await authService._users.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'E-Mail bereits vorhanden', requestId: req.id });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = new User({
      id: randomUUID(),
      email,
      passwordHash,
      role,
      isActive: true,
    });
    await authService._users.save(user);

    await auditService.write({
      actorUserId: req.user.sub,
      actorLabel:  req.user.email,
      action:      AUDIT_ACTIONS.USER_CREATED ?? 'user.created',
      targetType:  'user',
      targetId:    user.id,
      metadata:    { email: user.email, role: user.role },
      ip:          req.ip,
    });

    return res.status(201).json({ data: user.toPublicJSON(), requestId: req.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
