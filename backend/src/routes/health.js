'use strict';

const { Router } = require('express');
const { version } = require('../../package.json');
const config = require('../config');
const router = Router();

// GET /api/v1/health — Liveness + Readiness (inkl. DB-Status wenn verfügbar).
// Der Endpoint ist unauthentifiziert (Monitoring/Docker-Healthcheck). Die App-Version
// wird mitgeliefert, weil die (authentifizierten) Admin-Seiten Settings/SystemStatus sie
// anzeigen und Nexora als internes Appliance betrieben wird — die Version-Disclosure ist
// hier marginal (OWASP A05/A06). Bei internet-exponiertem Betrieb sollte die Version hinter
// Auth wandern (eigener authentifizierter Endpoint), dann hier wieder entfernen.
router.get('/', async (req, res) => {
  const health = {
    status:    'ok',
    service:   'soc-ticket-api',
    version,
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    requestId: req.id,
    db:        'not_configured',
  };

  // DB-Status nur wenn Datenbankverbindung konfiguriert ist — über den gecachten,
  // fehlersicheren Checker auf dem eigenen Health-Pool (kippt nicht bei API-Pool-
  // Sättigung, hängt nicht, drosselt die Last via TTL). check() wirft nie.
  if (config.db.enabled) {
    try {
      const { dbHealthChecker } = require('../services/dbHealthInstance');
      const r = await dbHealthChecker.check();
      health.db = r.db; // 'ok' | 'error'
      if (r.db !== 'ok') health.status = 'degraded';
    } catch {
      // Defensive: selbst wenn das Wiring fehlschlägt, bleibt die Antwort aussagekräftig.
      health.db     = 'error';
      health.status = 'degraded';
    }
  }

  res.json(health);
});

module.exports = router;
