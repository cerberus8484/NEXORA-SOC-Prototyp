'use strict';

// ── MFA Brute-Force-Rate-Limit (Security-Fix HIGH, Code-Scan 2026-07-03) ──────
//
// Die 2.-Faktor-Verifikation prüft einen 6-stelligen TOTP-Code. Ohne Limit wären
// im Challenge-Fenster tausende Rateversuche möglich (setzt ein gültiges Passwort
// voraus — der Login-Limiter greift dort). Diese beiden Limiter kappen das:
//
//   mfaChallengeLimiter — POST /auth/mfa (unauthentifiziert bis auf die Challenge):
//     Schlüssel = der Challenge-Token (gehasht) → pro Challenge gekappt, NAT-
//     transparent. Fallback auf die IP, wenn (fehlerhaft) kein Token gesendet wird.
//
//   mfaUserLimiter — POST /mfa/verify + /mfa/disable (authentifiziert):
//     Schlüssel = die User-ID (req.user.sub) → muss NACH requireAuth laufen.
//
// Beide zählen NUR fehlgeschlagene Versuche (skipSuccessfulRequests) → ein
// legitimer Code (2xx) wird nie mitgezählt und der Nutzer nie ausgesperrt.
//
// Fail-Secure: in Produktion NIE übersprungen. Nur im Test-Modus inaktiv, solange
// MFA_VERIFY_MAX nicht gesetzt ist (analog routes/provisioning.js) — damit die
// übrigen MFA-Suiten (die je einen Code senden) nicht throttlen.

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

function skipUnlessConfiguredInTest() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.NODE_ENV === 'test' && !process.env.MFA_VERIFY_MAX;
}

// Gemeinsame Bausteine — identische Fenster/Max + neutrale 429-Antwort ohne Leak.
const base = {
  windowMs: config.mfa.verifyLimit.windowMs,
  max:      config.mfa.verifyLimit.max,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: skipUnlessConfiguredInTest,
  message: { error: 'TOO_MANY_REQUESTS' },
};

const mfaChallengeLimiter = rateLimit({
  ...base,
  keyGenerator: (req) => {
    const ct = req.body && typeof req.body.challengeToken === 'string' ? req.body.challengeToken : '';
    // Den rohen Token nie als Store-Key halten → SHA-256 (feste Länge, kein Leak).
    return ct ? `mfa_ct:${crypto.createHash('sha256').update(ct).digest('hex')}` : ipKeyGenerator(req.ip);
  },
});

const mfaUserLimiter = rateLimit({
  ...base,
  keyGenerator: (req) => (req.user && (req.user.sub || req.user.id)) || ipKeyGenerator(req.ip),
});

module.exports = { mfaChallengeLimiter, mfaUserLimiter };
