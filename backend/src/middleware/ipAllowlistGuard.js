'use strict';

// IP-Allowlist-Guard — beschränkt den API-Zugriff auf erlaubte IP-Bereiche.
//
// Fail-safe-Design:
//   - Deaktiviert (Default) → kein Overhead, alle passieren.
//   - Aktiviert, aber leere Liste → alle passieren (kein versehentlicher Total-Lockout).
//   - Aktiviert + Liste → nur Quellen aus der Liste passieren, Rest 403.
//   - /health ist immer frei (Monitoring darf nie ausgesperrt werden).
//
// Wert wird im In-Memory-Cache gehalten (kein DB-Read pro Request).
// Exponiert: setIpAllowlist(enabled, cidrs) und refreshIpAllowlist(repo).
// Hinweis: Das SPA-Frontend wird von nginx ausgeliefert, nicht von dieser API —
// die Allowlist beschränkt also den API-Zugriff, nicht das Laden der Login-Seite.

const { ipInAllowlist, parseCidrList } = require('./ipAllowlist');

// /health als vollständiges Pfad-Segment befreien (nicht via includes —
// sonst wäre z.B. /api/v1/tickets/health-check versehentlich frei).
const HEALTH_PATH = /\/health(\/|$)/;

function createIpAllowlistGuard() {
  let _enabled = false;
  let _cidrs = [];

  function middleware(req, res, next) {
    // Fast path: aus oder leere Liste → niemanden aussperren.
    if (!_enabled || _cidrs.length === 0) return next();

    const path = req.path ?? '';
    if (HEALTH_PATH.test(path)) return next();

    if (ipInAllowlist(req.ip, _cidrs)) return next();

    return res.status(403).json({
      error:   'IP_NOT_ALLOWED',
      message: 'Zugriff von dieser IP-Adresse ist nicht erlaubt.',
    });
  }

  function setIpAllowlist(enabled, cidrsRaw) {
    _enabled = Boolean(enabled);
    _cidrs = parseCidrList(cidrsRaw);
  }

  async function refreshIpAllowlist(settingsRepo) {
    const enabled = await settingsRepo.get('platform_ipAllowlistEnabled');
    const cidrs   = await settingsRepo.get('platform_ipAllowlistCidrs');
    _enabled = Boolean(enabled);
    _cidrs = parseCidrList(cidrs);
  }

  return { middleware, setIpAllowlist, refreshIpAllowlist };
}

const defaultGuard = createIpAllowlistGuard();

module.exports = {
  createIpAllowlistGuard,
  ipAllowlistGuard:   defaultGuard.middleware,
  setIpAllowlist:     defaultGuard.setIpAllowlist,
  refreshIpAllowlist: defaultGuard.refreshIpAllowlist,
};
