'use strict';

const client = require('prom-client');

// P_STABILITY_2 — Queue-Sichtbarkeit: Tiefe, laufende Jobs, Alter des ältesten
// wartenden Jobs. Werte werden BEIM SCRAPE aus dem injizierten stats() gelesen
// (async erlaubt). Fehler-sicher: ein stats()-Fehler kippt den Scrape NICHT.
async function safeStats(statsFn) {
  try {
    return typeof statsFn === 'function' ? await statsFn() : null;
  } catch {
    return null;
  }
}

function registerQueueMetrics(registry, { stats } = {}) {
  new client.Gauge({
    name: 'soc_integration_queue_depth',
    help: 'Wartende Integration-Jobs in der Queue',
    registers: [registry],
    async collect() { const s = await safeStats(stats); if (s) this.set(s.depth ?? 0); },
  });
  new client.Gauge({
    name: 'soc_integration_queue_running',
    help: 'Aktuell laufende Integration-Jobs (Queue-Sicht)',
    registers: [registry],
    async collect() { const s = await safeStats(stats); if (s) this.set(s.running ?? 0); },
  });
  new client.Gauge({
    name: 'soc_integration_queue_oldest_age_seconds',
    help: 'Alter des ältesten wartenden Integration-Jobs in Sekunden',
    registers: [registry],
    async collect() { const s = await safeStats(stats); if (s) this.set((s.oldestQueuedAgeMs ?? 0) / 1000); },
  });
  // P_CORR_0 — Fehler-/Retry-Sichtbarkeit. Prozess-Zähler (setzen sich beim Neustart zurück):
  // failed = fehlgeschlagene Verarbeitungsversuche, retry = als Retry verarbeitete Jobs.
  new client.Gauge({
    name: 'soc_integration_queue_failed_total',
    help: 'Fehlgeschlagene Job-Verarbeitungsversuche seit Prozessstart (Queue-Sicht)',
    registers: [registry],
    async collect() { const s = await safeStats(stats); if (s) this.set(s.failed ?? 0); },
  });
  new client.Gauge({
    name: 'soc_integration_queue_retry_total',
    help: 'Als Retry verarbeitete Jobs seit Prozessstart (Queue-Sicht)',
    registers: [registry],
    async collect() { const s = await safeStats(stats); if (s) this.set(s.retried ?? 0); },
  });
}

module.exports = { registerQueueMetrics };
