'use strict';

const client = require('prom-client');
const { registerQueueMetrics } = require('../../src/metrics/queueMetrics');

describe('registerQueueMetrics', () => {
  it('liest Tiefe/laufend/Alter/failed/retry aus stats() beim Scrape', async () => {
    const registry = new client.Registry();
    registerQueueMetrics(registry, { stats: async () => ({ depth: 4, running: 1, oldestQueuedAgeMs: 2500, failed: 7, retried: 3 }) });

    const text = await registry.metrics();
    expect(text).toContain('soc_integration_queue_depth 4');
    expect(text).toContain('soc_integration_queue_running 1');
    expect(text).toContain('soc_integration_queue_oldest_age_seconds 2.5');
    expect(text).toContain('soc_integration_queue_failed_total 7');
    expect(text).toContain('soc_integration_queue_retry_total 3');
  });

  it('ein stats()-Fehler kippt den Scrape nicht (fehler-sicher)', async () => {
    const registry = new client.Registry();
    registerQueueMetrics(registry, { stats: async () => { throw new Error('boom'); } });

    const text = await registry.metrics();
    expect(text).toContain('soc_integration_queue_depth'); // Metrik existiert, kein Crash
  });
});
