'use strict';

const { metrics }        = require('../metrics/metricsRegistry');
const { normalizeRoute } = require('../metrics/normalizeRoute');

/**
 * Express-Middleware: zählt jeden HTTP-Request und misst seine Dauer.
 * Schreibt in soc_http_requests_total + soc_http_request_duration_seconds.
 * Der /metrics-Endpoint selbst wird übersprungen (würde sich sonst selbst messen).
 */
function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') return next();

  const endTimer = metrics.httpRequestDuration.startTimer();
  metrics.httpRequestsInFlight.inc();

  // In-Flight genau einmal verringern — egal ob finish (normal) oder close (Abbruch),
  // sonst leckt der Gauge bei abgebrochenen Verbindungen.
  let settled = false;
  const settle = () => { if (!settled) { settled = true; metrics.httpRequestsInFlight.dec(); } };

  res.on('finish', () => {
    const route = normalizeRoute(req.originalUrl || req.url || req.path);
    const labels = { method: req.method, route };
    endTimer(labels);
    // status_code trägt 4xx/5xx → Fehlerquote ist daraus ableitbar (PromQL), kein Extra-Zähler.
    metrics.httpRequestsTotal.inc({ ...labels, status_code: res.statusCode });
    settle();
  });
  res.on('close', settle);

  next();
}

module.exports = metricsMiddleware;
