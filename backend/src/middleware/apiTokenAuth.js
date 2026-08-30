'use strict';

const config             = require('../config');
const { apiTokenService } = require('../services/ApiTokenService');
const logger             = require('../logger');

// ── apiTokenAuth — PAT-Authentifizierung als Ergänzung zu JWT ────────────────
//
// Wird NACH requireAuth ausgeführt — wenn JWT fehlschlägt UND der Bearer-Token
// mit "soc_" beginnt, versucht diese Middleware eine PAT-Authentifizierung.
//
// Ablauf:
//   1. API_TOKENS_ENABLED=false → sofort next() (kein Fehler, JWT-Auth greift normal)
//   2. Bearer-Token vorhanden und beginnt mit soc_ → PAT-Lookup
//   3. Gültiger PAT → req.user = { id: userId, role: user.role, tokenId }
//   4. Ungültiger PAT → nächste Middleware (kein Fehler → Downstream entscheidet)
//
// SICHERHEIT: Dieser Middleware vertraut dem Bearer-Header nicht blind —
//   er führt immer einen DB-Lookup durch und prüft isActive.

async function apiTokenAuth(req, res, next) {
  // Hard-Gate: wenn disabled → überspringen
  if (!config.apiTokens.enabled) return next();

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  const raw = header.slice(7);
  if (!raw.startsWith('soc_')) return next();

  try {
    const result = await apiTokenService.authenticate(raw);
    if (!result) return next();

    // PAT ist gültig — req.user setzen (role wird auf 'analyst' gesetzt,
    // da PATs keine eigene Rolle tragen und immer analyst-Minimum haben).
    // Für erweiterte Rollen-Unterstützung: User-Repo-Lookup hinzufügen.
    req.user    = { id: result.userId, sub: result.userId, role: 'analyst', tokenId: result.tokenId };
    req.userPat = true;
    next();
  } catch (err) {
    logger.warn({ err }, 'PAT-Auth-Fehler (non-fatal)');
    next();
  }
}

module.exports = { apiTokenAuth };
