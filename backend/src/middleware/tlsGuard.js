'use strict';

// TLS-Guard — lehnt unverschlüsselte (HTTP-)Anfragen ab, wenn aktiviert.
//
// In Produktion terminiert nginx TLS und leitet 80→443 um; dieser Guard ist die
// zusätzliche App-seitige Durchsetzung (Defense in Depth). Hinter dem Proxy wird
// das Protokoll aus X-Forwarded-Proto gelesen (app.set('trust proxy', 1) → req.secure).
//
// Fail-safe: Deaktiviert (Default) → kein Overhead. /health bleibt immer frei.
// Wert im In-Memory-Cache (kein DB-Read pro Request).
// Exponiert: setTlsEnforce(flag) und refreshTlsEnforce(repo).

// /health als vollständiges Pfad-Segment befreien (nicht via includes —
// sonst wäre z.B. /api/v1/tickets/health-check versehentlich frei).
const HEALTH_PATH = /\/health(\/|$)/;

function isSecure(req) {
  if (req.secure) return true; // express setzt das via trust proxy + X-Forwarded-Proto
  const xfp = req.headers && req.headers['x-forwarded-proto'];
  if (typeof xfp === 'string' && xfp.split(',')[0].trim().toLowerCase() === 'https') return true;
  return false;
}

function createTlsGuard() {
  let _enforce = false;

  function middleware(req, res, next) {
    if (!_enforce) return next();

    const path = req.path ?? '';
    if (HEALTH_PATH.test(path)) return next();

    if (isSecure(req)) return next();

    return res.status(403).json({
      error:   'TLS_REQUIRED',
      message: 'Unverschlüsselte Verbindungen sind nicht erlaubt (TLS erforderlich).',
    });
  }

  function setTlsEnforce(flag) {
    _enforce = Boolean(flag);
  }

  async function refreshTlsEnforce(settingsRepo) {
    _enforce = Boolean(await settingsRepo.get('platform_tlsEnforce'));
  }

  return { middleware, setTlsEnforce, refreshTlsEnforce };
}

const defaultGuard = createTlsGuard();

module.exports = {
  createTlsGuard,
  isSecure,
  tlsGuard:          defaultGuard.middleware,
  setTlsEnforce:     defaultGuard.setTlsEnforce,
  refreshTlsEnforce: defaultGuard.refreshTlsEnforce,
};
