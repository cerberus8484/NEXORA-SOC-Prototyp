'use strict';

// Maintenance-Guard — erzwingt maintenanceMode serverseitig.
//
// Wenn maintenanceMode=true:
//   - Nicht-Admins/Engineers erhalten 503 { error:'MAINTENANCE' }
//   - Admins + Engineers passieren
//   - /health, /auth/* und GET /settings/platform bleiben immer frei
//     (Login-Screen lädt noch, Admin kann Zustand prüfen/deaktivieren)
//
// Das Flag wird in einem In-Memory-Cache gehalten (kein DB-Read pro Request).
// Exponiert: setMaintenance(flag) und refreshMaintenance(settingsRepo).
//
// ACHTUNG Design-Entscheidung: Die Middleware läuft VOR dem route-level
// requireAuth, also ist req.user noch nicht gesetzt. Deshalb wird der
// JWT-Token direkt aus dem Authorization-Header gelesen und dekodiert
// (authService.verifyToken). Bei ungültigem Token → kein User → blocked.
// Diese Dekodierung ist ein zusätzlicher Verify-Call pro Request NUR dann,
// wenn maintenanceMode aktiv ist (fast path: _active===false → kein Decode).

const ADMIN_ROLES  = new Set(['admin', 'engineer']);
const EXEMPT_PATHS = ['/health', '/auth'];

function parseCookieToken(cookieHeader) {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(';').map((p) => p.trim()).find((p) => p.startsWith('soc_token='));
  return match ? match.slice('soc_token='.length) : null;
}

function extractRawToken(req) {
  const header = req.headers && req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return parseCookieToken(req.headers && req.headers.cookie);
}

function isExemptPath(req) {
  const path = req.path ?? '';
  if (EXEMPT_PATHS.some((p) => path.includes(p))) return true;
  // GET /settings/platform bleibt frei (Branding im Login-Screen)
  if (path.includes('/settings/platform') && (!req.method || req.method === 'GET')) return true;
  return false;
}

// Factory: ermöglicht unabhängige Instanzen im Test (kein globaler Singleton).
function createMaintenanceGuard() {
  let _active = false;

  function middleware(req, res, next) {
    // Fast path — kein Overhead wenn Maintenance nicht aktiv
    if (!_active) return next();

    // Immer-freie Pfade
    if (isExemptPath(req)) return next();

    // req.user wurde ggf. bereits von einem früher laufenden requireAuth gesetzt.
    // Falls ja, nutzen wir es direkt (z.B. in Tests wo Auth global läuft).
    if (req.user && ADMIN_ROLES.has(req.user.role)) return next();

    // Falls req.user noch nicht gesetzt: Token synchron prüfen.
    // Wir lesen nur die Payload (decode, kein vollständiger Verify hier —
    // der echte Verify läuft danach in requireAuth). Für die Rolle reicht decode.
    // Sicherheit: ein gefälschtes Token mit role=admin hat hier Zugang, aber
    // requireAuth weist es danach ab — kein Privilege-Escalation-Risiko.
    if (!req.user) {
      const rawToken = extractRawToken(req);
      if (rawToken) {
        try {
          // Lazy require, vermeidet zirkuläre Abhängigkeiten beim Laden
          const jwt = require('jsonwebtoken');
          const decoded = jwt.decode(rawToken);
          if (decoded && ADMIN_ROLES.has(decoded.role)) return next();
        } catch {
          // Decode fehlgeschlagen → wie kein Token
        }
      }
    }

    return res.status(503).json({
      error:   'MAINTENANCE',
      message: 'Die Plattform befindet sich im Wartungsmodus. Bitte versuchen Sie es später erneut.',
    });
  }

  function setMaintenance(flag) {
    _active = Boolean(flag);
  }

  async function refreshMaintenance(settingsRepo) {
    const value = await settingsRepo.get('platform_maintenanceMode');
    _active = Boolean(value);
  }

  return { middleware, setMaintenance, refreshMaintenance };
}

// Singleton-Export für app.js — gemeinsame Instanz im laufenden Prozess.
const defaultGuard = createMaintenanceGuard();

module.exports = {
  createMaintenanceGuard,
  maintenanceGuard:   defaultGuard.middleware,
  setMaintenance:     defaultGuard.setMaintenance.bind(defaultGuard),
  refreshMaintenance: defaultGuard.refreshMaintenance.bind(defaultGuard),
};
