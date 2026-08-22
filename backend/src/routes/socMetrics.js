'use strict';

/**
 * socMetrics-Router — GET /v1/soc-metrics
 *
 * Liefert aggregierte SOC-KPIs: MTTR, FP-Rate, Counts nach State/Status,
 * Top-Rules, Last pro Analyst (+ meta.capped Stichproben-Hinweis).
 *
 * Sicherheit: Auth + RBAC sind HIER verdrahtet (defense-in-depth), nicht dem
 * Mount-Aufrufer überlassen — sonst wäre der Endpunkt bei versehentlichem Mount
 * ohne Middleware offen. Zugang nur engineer/admin.
 *
 * DSGVO: analystLoad zeigt Analyst-Namen (berechtigtes Interesse: SOC-Betriebs-
 * steuerung, Art. 6 Abs. 1f) — deshalb hinter engineer+/admin verriegelt, keine
 * öffentliche Sicht. Nur aggregierte Zählwerte, kein Aktivitäts-Rohdaten-Dump.
 *
 * DI: createSocMetricsRouter({ service }) erlaubt Test-Injektion; ohne Param wird
 * der Service beim Mount (App-Start) erzeugt → DB-Config-Fehler werden früh sichtbar.
 */
const express                    = require('express');
const { requireAuth, requireRole } = require('../middleware/authenticate');
const { SocMetricsService }      = require('../services/SocMetricsService');
const { createTicketRepository } = require('../repositories/ticketRepositoryFactory');

// Sentinel: `since` war gesetzt, ließ sich aber nicht als Datum parsen.
const INVALID = Symbol('invalid-since');

/**
 * Validiert den optionalen `since`-Query-Param.
 * @param {unknown} raw
 * @returns {string|null|typeof INVALID} normalisierter ISO-String, null (nicht gesetzt) oder INVALID.
 */
function parseSince(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return INVALID; // ?since=a&since=b → Array → ablehnen
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return INVALID;
  return new Date(ms).toISOString();
}

function createSocMetricsRouter({ service } = {}) {
  const router = express.Router();
  const svc = service || new SocMetricsService({ ticketRepo: createTicketRepository() });

  router.get('/', requireAuth, requireRole('engineer', 'admin'), async (req, res, next) => {
    try {
      // Zeitraumfilter (Audit #2): optionales ?since=<ISO>. Strikt validiert —
      // nur ein parsebares Datum wird durchgereicht; ungültig → 400 (kein stiller
      // Fallback auf All-Time, keine Injection über den Query-Param).
      const since = parseSince(req.query.since);
      if (since === INVALID) {
        return res.status(400).json({ success: false, error: 'since muss ein gültiger ISO-8601-Zeitstempel sein', requestId: req.id });
      }
      res.json({ success: true, data: await svc.getMetrics({ since }), requestId: req.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createSocMetricsRouter };
