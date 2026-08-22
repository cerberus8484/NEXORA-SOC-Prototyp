'use strict';

/**
 * authCookies.js — geteilte Cookie-Semantik für jeden Login-Pfad.
 *
 * Passwort-Login, MFA-Abschluss und SSO/OIDC stellen DENSELBEN Session-Cookie aus.
 * Eine einzige Quelle verhindert, dass die Pfade in Sicherheits-Flags (httpOnly,
 * secure, sameSite, Laufzeit) auseinanderlaufen.
 *   - soc_token : httpOnly (XSS-Härtung), sameSite=strict, secure in Produktion.
 *   - csrf_token: bewusst NICHT httpOnly (Frontend liest + spiegelt als Header),
 *                 sameSite=strict (kommt in keinem Cross-Site-Kontext mit).
 */

const { randomBytes } = require('crypto');

// JWT-Laufzeit als ms → Cookie-maxAge (entspricht der Token-Gültigkeit, Default 8h).
const JWT_EXPIRES_MS = (() => {
  const raw = process.env.JWT_EXPIRES_IN || '8h';
  const match = raw.match(/^(\d+)(h|m|s|d)$/);
  if (!match) return 8 * 60 * 60 * 1000;
  const n = parseInt(match[1], 10);
  const unit = { h: 3600, m: 60, s: 1, d: 86400 }[match[2]];
  return n * unit * 1000;
})();

function setTokenCookie(res, token) {
  res.cookie('soc_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   JWT_EXPIRES_MS,
  });
}

function setCsrfCookie(res) {
  res.cookie('csrf_token', randomBytes(32).toString('hex'), {
    httpOnly: false,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   JWT_EXPIRES_MS,
  });
}

function clearAuthCookies(res) {
  res.clearCookie('soc_token', { httpOnly: true, sameSite: 'strict' });
  res.clearCookie('csrf_token', { sameSite: 'strict' });
}

/**
 * Liest einen einzelnen Cookie aus dem rohen Cookie-Header (das Projekt nutzt
 * bewusst kein cookie-parser). Gibt null zurück, wenn nicht vorhanden.
 * @param {string|undefined} cookieHeader — req.headers.cookie
 * @param {string} name
 * @returns {string|null}
 */
function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

module.exports = { setTokenCookie, setCsrfCookie, clearAuthCookies, readCookie, JWT_EXPIRES_MS };
