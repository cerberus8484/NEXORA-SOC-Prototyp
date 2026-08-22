'use strict';

// SIEM-Dashboards — read-only, pro SIEM ein registrierter Provider.
// RBAC: requireAuth (viewer+). Capability-Gate: Provider muss existieren + konfiguriert sein.

const { Router }              = require('express');
const { requireAuth }        = require('../middleware/authenticate');
const { getProvider, listProviders } = require('../integrations/siemDashboards');

const router = Router();

// GET /api/v1/siem — verfügbare SIEM-Dashboards (Key + ob konfiguriert)
router.get('/', requireAuth, (req, res) => {
  res.json({ data: listProviders(), requestId: req.id });
});

// GET /api/v1/siem/:siem/dashboard — komplettes Dashboard-DTO der SIEM-Quelle
router.get('/:siem/dashboard', requireAuth, async (req, res, next) => {
  try {
    const provider = getProvider(req.params.siem);
    if (!provider) {
      return res.status(404).json({ error: 'unknown_siem', siem: req.params.siem, requestId: req.id });
    }
    if (!provider.isEnabled()) {
      return res.json({ enabled: false, siem: provider.key, data: null, requestId: req.id });
    }
    const data = await provider.getDashboard();
    res.json({ enabled: true, siem: provider.key, data, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/siem/:siem/telemetry — Zeitreihen fürs Dashboard (Zähler, keine PII).
// Fixed Window 24h/15m — bewusst keine Query-Parameter (keine Eingabe-Oberfläche).
router.get('/:siem/telemetry', requireAuth, async (req, res, next) => {
  try {
    const provider = getProvider(req.params.siem);
    if (!provider) {
      return res.status(404).json({ error: 'unknown_siem', siem: req.params.siem, requestId: req.id });
    }
    if (!provider.isEnabled() || typeof provider.getTelemetry !== 'function') {
      return res.json({ enabled: false, siem: provider.key, data: null, requestId: req.id });
    }
    const data = await provider.getTelemetry();
    res.json({ enabled: data !== null, siem: provider.key, data, requestId: req.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
