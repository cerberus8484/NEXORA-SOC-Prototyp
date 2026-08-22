'use strict';

const client = require('prom-client');

// P_STABILITY_1 · Task 1 — DB-Pool-Auslastung als Gauges, beim Scrape aus den
// injizierten Snapshots gelesen. snapshot() liefert { total, idle, waiting, max }
// oder null (Pool nicht aktiv, z.B. DB_ENABLED=false). API- und Health-Pool getrennt.
// NUR Zähler — keine DB-Inhalte, keine Query-Parameter.
function registerPoolMetrics(registry, { apiSnapshot, healthSnapshot } = {}) {
  const pools = () => [['api', apiSnapshot], ['health', healthSnapshot]];

  const conn = new client.Gauge({
    name: 'soc_db_pool_connections',
    help: 'DB-Pool-Verbindungen nach Zustand (total/idle/waiting)',
    labelNames: ['pool', 'state'],
    registers: [registry],
    collect() {
      for (const [pool, snapFn] of pools()) {
        const s = typeof snapFn === 'function' ? snapFn() : null;
        if (!s) continue;
        this.set({ pool, state: 'total' },   s.total ?? 0);
        this.set({ pool, state: 'idle' },    s.idle ?? 0);
        this.set({ pool, state: 'waiting' }, s.waiting ?? 0);
      }
    },
  });

  const max = new client.Gauge({
    name: 'soc_db_pool_max',
    help: 'Maximale DB-Pool-Größe',
    labelNames: ['pool'],
    registers: [registry],
    collect() {
      for (const [pool, snapFn] of pools()) {
        const s = typeof snapFn === 'function' ? snapFn() : null;
        if (s && s.max != null) this.set({ pool }, s.max);
      }
    },
  });

  return { conn, max };
}

module.exports = { registerPoolMetrics };
