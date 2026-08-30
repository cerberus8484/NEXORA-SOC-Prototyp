'use strict';

const client = require('prom-client');

// P_STABILITY_1 · Task 1 — wenige, klare Node-Runtime-Gauges (RAM/Heap/Uptime/Event-Loop).
// Werte werden BEIM SCRAPE gelesen (collect) → kein eigener Timer, kaum Last.
// Bewusst NICHT prom-client collectDefaultMetrics (Rausch-Reduktion), nur diese Signale.
// Keine Secrets/IDs/PII — die Node-Version ist öffentlich.
function registerRuntimeMetrics(registry, { lagMonitor, memoryUsage = () => process.memoryUsage(), uptime = () => process.uptime() } = {}) {
  new client.Gauge({
    name: 'soc_process_resident_memory_bytes',
    help: 'Resident Set Size (RSS) des Node-Prozesses in Bytes',
    registers: [registry],
    collect() { this.set(memoryUsage().rss); },
  });
  new client.Gauge({
    name: 'soc_nodejs_heap_used_bytes',
    help: 'Genutzter V8-Heap in Bytes',
    registers: [registry],
    collect() { this.set(memoryUsage().heapUsed); },
  });
  new client.Gauge({
    name: 'soc_nodejs_heap_total_bytes',
    help: 'Reservierter V8-Heap in Bytes',
    registers: [registry],
    collect() { this.set(memoryUsage().heapTotal); },
  });
  new client.Gauge({
    name: 'soc_nodejs_external_memory_bytes',
    help: 'Externer Speicher (C++/Buffer) in Bytes',
    registers: [registry],
    collect() { this.set(memoryUsage().external); },
  });
  new client.Gauge({
    name: 'soc_process_uptime_seconds',
    help: 'Prozess-Laufzeit in Sekunden',
    registers: [registry],
    collect() { this.set(uptime()); },
  });
  new client.Gauge({
    name: 'soc_event_loop_lag_seconds',
    help: 'Event-Loop-Lag in Sekunden (Blockierung des Loops)',
    registers: [registry],
    collect() { this.set(lagMonitor ? lagMonitor.getLagSeconds() : 0); },
  });
  // Node-Version als Info-Gauge (Wert immer 1, Version im Label).
  new client.Gauge({
    name: 'soc_nodejs_info',
    help: 'Node.js-Laufzeit-Info (Wert immer 1)',
    labelNames: ['version'],
    registers: [registry],
  }).set({ version: process.version }, 1);
}

module.exports = { registerRuntimeMetrics };
