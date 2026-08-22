'use strict';

const { AbuseIpDbProvider } = require('../../src/integrations/threatIntel/AbuseIpDbProvider');
const { VirusTotalProvider } = require('../../src/integrations/threatIntel/VirusTotalProvider');
const { InMemoryHttpClient } = require('../../src/integrations/http/InMemoryHttpClient');

describe('AbuseIpDbProvider (gemockt)', () => {
  test('ohne Key → not configured', () => {
    expect(new AbuseIpDbProvider({}).isConfigured()).toBe(false);
    expect(new AbuseIpDbProvider({ key: 'k' }).isConfigured()).toBe(true);
  });

  test('öffentliche IP mit hohem Confidence → malicious', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/v2/check', 200, { data: { abuseConfidenceScore: 92, totalReports: 41, countryCode: 'NL', usageType: 'Data Center', isp: 'X' } });
    const p = new AbuseIpDbProvider({ key: 'k', http });
    const r = await p.enrich('ip', '185.220.101.12');
    expect(r.status).toBe('ok');
    expect(r.verdict).toBe('malicious');
    expect(r.confidence).toBe(92);
    expect(r.details.tags).toEqual(expect.arrayContaining(['NL']));
    const req = http.getLastRequest();
    expect(req.headers.Key).toBe('k');
  });

  test('private/multicast IP → NICHT extern abgefragt (skipped)', async () => {
    const http = new InMemoryHttpClient();
    const p = new AbuseIpDbProvider({ key: 'k', http });
    const r1 = await p.enrich('ip', '192.168.241.102');
    const r2 = await p.enrich('ip', '224.0.0.7');
    expect(r1.details.skipped).toBe(true);
    expect(r2.details.skipped).toBe(true);
    expect(http.requestCount()).toBe(0); // KEIN externer Call
  });

  test('429 → rate_limited (Service läuft weiter)', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/v2/check', 429, { errors: ['rate limit'] });
    const r = await new AbuseIpDbProvider({ key: 'k', http }).enrich('ip', '8.8.8.8');
    expect(r.status).toBe('rate_limited');
  });

  test('nicht-IP-Indikator → unknown, kein Call', async () => {
    const http = new InMemoryHttpClient();
    const r = await new AbuseIpDbProvider({ key: 'k', http }).enrich('domain', 'evil.tld');
    expect(r.verdict).toBe('unknown');
    expect(http.requestCount()).toBe(0);
  });
});

describe('VirusTotalProvider (gemockt)', () => {
  // Echtes VT-v3-Body: { data: { attributes: { last_analysis_stats, ... } } }
  const vtResp = (stats) => ({ data: { attributes: { last_analysis_stats: stats, as_owner: 'Example AS', country: 'NL', reputation: -10 } } });

  test('ohne Key → not configured', () => {
    expect(new VirusTotalProvider({}).isConfigured()).toBe(false);
  });

  test('viele malicious Engines → malicious', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/v3/ip_addresses/', 200, vtResp({ malicious: 6, suspicious: 2, harmless: 60, undetected: 4 }));
    const r = await new VirusTotalProvider({ key: 'k', http }).enrich('ip', '185.220.101.12');
    expect(r.status).toBe('ok');
    expect(r.verdict).toBe('malicious');
    expect(r.details.malicious).toBe(6);
    expect(http.getLastRequest().headers['x-apikey']).toBe('k');
  });

  test('nur harmless → clean', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/v3/ip_addresses/', 200, vtResp({ malicious: 0, suspicious: 0, harmless: 70, undetected: 6 }));
    const r = await new VirusTotalProvider({ key: 'k', http }).enrich('ip', '8.8.8.8');
    expect(r.verdict).toBe('clean');
  });

  test('multicast → nicht abgefragt', async () => {
    const http = new InMemoryHttpClient();
    const r = await new VirusTotalProvider({ key: 'k', http }).enrich('ip', '224.0.0.7');
    expect(r.details.skipped).toBe(true);
    expect(http.requestCount()).toBe(0);
  });

  test('429 → rate_limited', async () => {
    const http = new InMemoryHttpClient();
    http.mockUrl('/api/v3/ip_addresses/', 429, {});
    const r = await new VirusTotalProvider({ key: 'k', http }).enrich('ip', '8.8.8.8');
    expect(r.status).toBe('rate_limited');
  });
});
