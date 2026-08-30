'use strict';

const { authService }     = require('../services/AuthService');
const { UnauthorizedError, ForbiddenError } = require('../errors/AppError');

// Liest einen einzelnen Cookie aus dem Cookie-Header ohne cookie-parser.
// Primärer Token-Pfad ist immer der Authorization-Bearer-Header; der Cookie
// ist nur ein additiver Fallback (Audit C4 — httpOnly-Cookie-Härtung).
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map(p => p.trim()).find(p => p.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

// Routen, die der Erst-Login-Passwortzwang NICHT sperren darf — sonst säße der
// User im Zwang fest (er muss sein Passwort ändern, sich abmelden und /me lesen können).
const PW_CHANGE_EXEMPT = ['/auth/change-password', '/auth/logout', '/auth/me'];
function isExemptFromPasswordChange(req) {
  const url = req.originalUrl || req.url || '';
  return PW_CHANGE_EXEMPT.some((p) => url.includes(p));
}

// requireAuth — prüft JWT, lädt User in req.user.
// Token-Quelle (Priorität):
//   1. Authorization: Bearer <token>  — für API-Clients, Tests, curl
//   2. Cookie soc_token (httpOnly)    — für Browser-Flows nach C4-Härtung
//
// CSRF-Schutz: sameSite=strict am Cookie schützt vor Cross-Site-Requests.
// Bearer-Header-Pfad ist CSRF-immun (Browser sendet ihn nie automatisch).
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const cookieToken = parseCookie(req.headers.cookie, 'soc_token');

  if (!header || !header.startsWith('Bearer ')) {
    // Kein Bearer-Header — Cookie-Fallback versuchen.
    if (!cookieToken) {
      return next(new UnauthorizedError('Kein Token — Authorization: Bearer <token> erforderlich'));
    }
  }

  const token = (header && header.startsWith('Bearer ')) ? header.slice(7) : cookieToken;
  try {
    const payload  = await authService.verifyToken(token);
    req.user       = payload;   // { sub, jti, role, email }
    req.userJti    = payload.jti;
    req.userExp    = payload.exp;  // für persistente Blocklist beim Logout

    // Erst-Login-Passwortzwang SERVERSEITIG durchsetzen (sonst nur Client-Gate →
    // Bypass mit gültigem JWT). Das JWT trägt das Flag nicht → frischer Read.
    // Ausgenommen: Passwort-Wechsel/Logout/Me — sonst käme der User nie heraus.
    if (!isExemptFromPasswordChange(req)) {
      const flags = await authService.getUserFlags(payload.sub);
      if (flags && flags.mustChangePassword) {
        return next(new ForbiddenError(
          'Passwortwechsel erforderlich (Erstanmeldung) — bitte zuerst das Passwort ändern.',
        ));
      }
    }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token abgelaufen'));
    }
    return next(new UnauthorizedError('Ungültiger Token'));
  }
}

// requireRole — prüft Minimum-Rolle
// Rollen-Hierarchie: admin > engineer > analyst > viewer.
// engineer darf u.a. weitergeleitete FP-Ausnahmen anwenden (mehr als analyst).
const ROLE_LEVELS = { admin: 4, engineer: 3, analyst: 2, viewer: 1 };

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(new UnauthorizedError('Nicht authentifiziert'));

    const userLevel    = ROLE_LEVELS[req.user.role] || 0;
    const requiredLevel = Math.min(...allowedRoles.map(r => ROLE_LEVELS[r] || 99));

    if (userLevel < requiredLevel) {
      return next(new ForbiddenError(
        `Rolle '${req.user.role}' hat keinen Zugriff — benötigt: ${allowedRoles.join(' oder ')}`
      ));
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
