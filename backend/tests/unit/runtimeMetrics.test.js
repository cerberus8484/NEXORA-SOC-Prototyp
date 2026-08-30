'use strict';

const client = require('prom-client');
const { registerRuntimeMetrics } = require('../../src/metrics/runtimeMetrics');

describe('registerRuntimeMetrics', () => {
  it('liest aktuelle Runtime-Werte beim Scrape (injizierte Quellen)', async () => {
    const registry = new client.Registry();
    registerRuntimeMetrics(registry, {
      lagMonitor:  { getLagSeconds: () => 0.25 },
      memoryUsage: () => ({ rss: 111, heapUsed: 222, heapTotal: 333, external: 444 }),
      uptime:      () => 555,
    });

    const text = await registry.metrics();
    expect(text).toContain('soc_process_resident_memory_bytes 111');
    expect(text).toContain('soc_nodejs_heap_used_bytes 222');
    expect(text).toContain('soc_nodejs_heap_total_bytes 333');
    expect(text).toContain('soc_nodejs_external_memory_bytes 444');
    expect(text).toContain('soc_process_uptime_seconds 555');
    expect(text).toContain('soc_event_loop_lag_seconds 0.25');
    expect(text).toMatch(/soc_nodejs_info\{version="[^"]+"\} 1/);
  });

  it('exportiert KEINE prom-client-Default-Node-Metriken', async () => {
    const registry = new client.Registry();
    registerRuntimeMetrics(registry, { lagMonitor: { getLagSeconds: () => 0 } });
    const text = await registry.metrics();
    expect(text).not.toContain('process_cpu_seconds_total');
    expect(text).not.toContain('nodejs_eventloop_lag_seconds'); // prom-client Default-Name
  });
});
