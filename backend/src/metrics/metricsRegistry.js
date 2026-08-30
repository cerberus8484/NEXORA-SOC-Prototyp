'use strict';

const client = require('prom-client');

/**
 * Eigene Prometheus-Registry (P20).
 *
 * Bewusst NICHT die globale Default-Registry — wir wollen nur unsere
 * SOC-Domänen-Metriken exposen, keine Node-/Process-Metriken (Heap, GC, …).
 * Grafana (10.99.99.55) scrapt /metrics im Prometheus-Textformat.
 */
const registry = new client.Registry();

const ticketsTotal = new client.Counter({
  name:       'soc_tickets_total',
  help:       'Insgesamt erstellte Tickets',
  labelNames: ['severity'],
  registers:  [registry],
});

const ticketsOpenGauge = new client.Gauge({
  name:      'soc_tickets_open_gauge',
  help:      'Aktuell offene Tickets',
  registers: [registry],
});

const httpRequestsTotal = new client.Counter({
  name:       'soc_http_requests_total',
  help:       'HTTP-Requests gesamt',
  labelNames: ['method', 'route', 'status_code'],
  registers:  [registry],
});

const httpRequestDuration = new client.Histogram({
  name:       'soc_http_request_duration_seconds',
  help:       'HTTP-Request-Dauer in Sekunden',
  labelNames: ['method', 'route'],
  buckets:    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers:  [registry],
});

const wazuhAlertsIngestedTotal = new client.Counter({
  name:      'soc_wazuh_alerts_ingested_total',
  help:      'Eingehende Wazuh-Webhook-Alerts',
  registers: [registry],
});

const agentSuggestionsTotal = new client.Counter({
  name:       'soc_agent_suggestions_total',
  help:       'KI-Agent-Vorschläge gesamt',
  labelNames: ['kind', 'verdict'],
  registers:  [registry],
});

// ── P_STABILITY_1 · Task 1 — Stabilitäts-Signale ─────────────────────────────

// HTTP: aktuell laufende Requests (zeigt Überlast/Stau an).
const httpRequestsInFlight = new client.Gauge({
  name:      'soc_http_requests_in_flight',
  help:      'Aktuell in Bearbeitung befindliche HTTP-Requests',
  registers: [registry],
});

// DB-Pool: Sättigungswarnungen (aus Task 3) + abgebrochene/zu langsame Queries.
const dbPoolSaturationWarningsTotal = new client.Counter({
  name:      'soc_db_pool_saturation_warnings_total',
  help:      'Anzahl erkannter DB-Pool-Sättigungen (Warnlog pg_pool_saturated)',
  registers: [registry],
});
const dbQueryTimeoutsTotal = new client.Counter({
  name:      'soc_db_query_timeouts_total',
  help:      'DB-Queries, die in statement_timeout/query_timeout liefen',
  registers: [registry],
});

// Hintergrundarbeit: verarbeitete Jobs, laufende Jobs, letzter Erfolg.
const integrationJobsProcessedTotal = new client.Counter({
  name:       'soc_integration_jobs_processed_total',
  help:       'Verarbeitete Integration-Jobs nach Ergebnis',
  labelNames: ['result'],
  registers:  [registry],
});
const integrationJobsInFlight = new client.Gauge({
  name:      'soc_integration_jobs_in_flight',
  help:      'Aktuell in Verarbeitung befindliche Integration-Jobs',
  registers: [registry],
});
const integrationLastSuccessTimestamp = new client.Gauge({
  name:      'soc_integration_last_success_timestamp_seconds',
  help:      'Unix-Zeit des letzten erfolgreich verarbeiteten Integration-Jobs',
  registers: [registry],
});

// Node-Runtime-Gauges (RAM/Heap/Uptime/Event-Loop) registrieren — Werte beim Scrape.
const { eventLoopLagMonitor } = require('./eventLoopLag');
const { registerRuntimeMetrics } = require('./runtimeMetrics');
registerRuntimeMetrics(registry, { lagMonitor: eventLoopLagMonitor });

module.exports = {
  registry,
  metrics: {
    ticketsTotal,
    ticketsOpenGauge,
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestsInFlight,
    wazuhAlertsIngestedTotal,
    agentSuggestionsTotal,
    dbPoolSaturationWarningsTotal,
    dbQueryTimeoutsTotal,
    integrationJobsProcessedTotal,
    integrationJobsInFlight,
    integrationLastSuccessTimestamp,
  },
};
