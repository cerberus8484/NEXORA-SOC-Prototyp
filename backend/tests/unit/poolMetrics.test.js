'use strict';

const client = require('prom-client');
const { registerPoolMetrics } = require('../../src/metrics/poolMetrics');

describe('registerPoolMetrics', () => {
  it('liest API- und Health-Pool getrennt aus', async () => {
    const registry = new client.Registry();
    registerPoolMetrics(registry, {
      apiSnapshot:    () => ({ total: 8, idle: 3, waiting: 1, max: 10 }),
      healthSnapshot: () => ({ total: 1, idle: 1, waiting: 0, max: 2 }),
    });

    const text = await registry.metrics();
    expect(text).toContain('soc_db_pool_connections{pool="api",state="total"} 8');
    expect(text).toContain('soc_db_pool_connections{pool="api",state="idle"} 3');
    expect(text).toContain('soc_db_pool_connections{pool="api",state="waiting"} 1');
    expect(text).toContain('soc_db_pool_connections{pool="health",state="idle"} 1');
    expect(text).toContain('soc_db_pool_max{pool="api"} 10');
    expect(text).toContain('soc_db_pool_max{pool="health"} 2');
  });

  it('überspringt nicht aktive Pools (snapshot null) ohne Crash', async () => {
    const registry = new client.Registry();
    registerPoolMetrics(registry, { apiSnapshot: () => null, healthSnapshot: () => null });

    const text = await registry.metrics();
    expect(text).toContain('soc_db_pool_connections'); // Metrik existiert (HELP/TYPE)
    expect(text).not.toMatch(/soc_db_pool_connections\{/); // aber kein Sample
  });
});
