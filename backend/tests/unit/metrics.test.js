'use strict';

const { registry, metrics } = require('../../src/metrics/metricsRegistry');
const { normalizeRoute, looksLikeId } = require('../../src/metrics/normalizeRoute');
const { isInternalIp, metricsTokenOk } = require('../../src/routes/metrics');
const { isAllowedOllamaUrl } = require('../../src/integrations/http/ollamaUrlAllowlist');

describe('metricsRegistry', () => {
  it('exportiert alle erwarteten Metrik-Namen', async () => {
    const text = await registry.metrics();
    const expected = [
      'soc_tickets_total',
      'soc_tickets_open_gauge',
      'soc_http_requests_total',
      'soc_http_request_duration_seconds',
      'soc_wazuh_alerts_ingested_total',
      'soc_agent_suggestions_total',
    ];
    for (const name of expected) {
      expect(text).toContain(name);
    }
  });

  it('exposed keine prom-client-Default-Node-Metriken (eigene soc_-Namen)', async () => {
    const text = await registry.metrics();
    expect(text).not.toContain('process_cpu_seconds_total');
    expect(text).not.toContain('nodejs_eventloop_lag_seconds'); // prom-client Default-Name
  });

  it('enthält die Task-1-Stabilitäts-Metriken (Runtime/HTTP/DB-Counter/Queue)', async () => {
    const text = await registry.metrics();
    const expected = [
      'soc_process_resident_memory_bytes',
      'soc_nodejs_heap_used_bytes',
      'soc_nodejs_heap_total_bytes',
      'soc_nodejs_external_memory_bytes',
      'soc_process_uptime_seconds',
      'soc_event_loop_lag_seconds',
      'soc_nodejs_info',
      'soc_http_requests_in_flight',
      'soc_db_pool_saturation_warnings_total',
      'soc_db_query_timeouts_total',
      'soc_integration_jobs_processed_total',
      'soc_integration_jobs_in_flight',
      'soc_integration_last_success_timestamp_seconds',
    ];
    for (const name of expected) expect(text).toContain(name);
  });

  it('stellt die SOC-Counter/Gauges als Objekte bereit', () => {
    expect(typeof metrics.ticketsTotal.inc).toBe('function');
    expect(typeof metrics.ticketsOpenGauge.set).toBe('function');
    expect(typeof metrics.httpRequestDuration.startTimer).toBe('function');
  });
});

describe('normalizeRoute', () => {
  it('ersetzt alphanumerische IDs durch :id', () => {
    expect(normalizeRoute('/v1/tickets/abc123')).toBe('/v1/tickets/:id');
  });

  it('ersetzt numerische IDs durch :id', () => {
    expect(normalizeRoute('/api/v1/tickets/42')).toBe('/api/v1/tickets/:id');
  });

  it('ersetzt UUIDs durch :id', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(normalizeRoute(`/v1/agent/${uuid}`)).toBe('/v1/agent/:id');
  });

  it('lässt Wort-Segmente ohne Ziffer unangetastet', () => {
    expect(normalizeRoute('/api/v1/integrations/sources')).toBe('/api/v1/integrations/sources');
  });

  it('schneidet Query-Strings ab', () => {
    expect(normalizeRoute('/v1/tickets?limit=10')).toBe('/v1/tickets');
  });

  it('liefert / für leeren oder ungültigen Input', () => {
    expect(normalizeRoute('')).toBe('/');
    expect(normalizeRoute(null)).toBe('/');
  });

  it('looksLikeId erkennt ID-artige Segmente', () => {
    expect(looksLikeId('abc123')).toBe(true);
    expect(looksLikeId('42')).toBe(true);
    expect(looksLikeId('sources')).toBe(false);
    expect(looksLikeId('webhook')).toBe(false);
  });
});

describe('isInternalIp (metrics IP-Gate)', () => {
  it('erlaubt interne 10.99.99.x-IPs', () => {
    expect(isInternalIp('10.99.99.55')).toBe(true);
  });

  it('erlaubt loopback', () => {
    expect(isInternalIp('127.0.0.1')).toBe(true);
    expect(isInternalIp('::1')).toBe(true);
  });

  it('erlaubt IPv4-mapped interne IPs', () => {
    expect(isInternalIp('::ffff:10.99.99.55')).toBe(true);
  });

  it('verweigert externe IPs', () => {
    expect(isInternalIp('8.8.8.8')).toBe(false);
    expect(isInternalIp('192.168.240.5')).toBe(false);
    expect(isInternalIp('')).toBe(false);
    expect(isInternalIp(null)).toBe(false);
  });
});

describe('metricsTokenOk (optionaler Scrape-Token)', () => {
  const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
  const orig = process.env.METRICS_TOKEN;
  afterEach(() => {
    if (orig === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = orig;
  });

  it('ohne METRICS_TOKEN immer ok (kein Verhaltenswechsel)', () => {
    delete process.env.METRICS_TOKEN;
    expect(metricsTokenOk(req())).toBe(true);
    expect(metricsTokenOk(req('irgendwas'))).toBe(true);
  });

  it('mit METRICS_TOKEN: korrekter Bearer ok, falscher/fehlender nicht', () => {
    process.env.METRICS_TOKEN = 'secret-scrape-token-123';
    expect(metricsTokenOk(req('secret-scrape-token-123'))).toBe(true);
    expect(metricsTokenOk(req('falsch'))).toBe(false);
    expect(metricsTokenOk(req())).toBe(false);
  });
});

describe('isAllowedOllamaUrl (geteilte SSRF-Allowlist)', () => {
  it('erlaubt localhost / RFC-1918', () => {
    expect(isAllowedOllamaUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isAllowedOllamaUrl('http://10.0.10.78:11434')).toBe(true);
    expect(isAllowedOllamaUrl('http://192.168.1.5:11434')).toBe(true);
    expect(isAllowedOllamaUrl('http://localhost:11434')).toBe(true);
  });

  it('verweigert externe Hosts', () => {
    expect(isAllowedOllamaUrl('http://evil.example.com')).toBe(false);
    expect(isAllowedOllamaUrl('http://8.8.8.8')).toBe(false);
    expect(isAllowedOllamaUrl('')).toBe(false);
    expect(isAllowedOllamaUrl(null)).toBe(false);
  });
});
