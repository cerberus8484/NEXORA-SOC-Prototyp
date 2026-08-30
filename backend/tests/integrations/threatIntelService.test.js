'use strict';

const { ThreatIntelService } = require('../../src/integrations/threatIntel/ThreatIntelService');
const { MockThreatIntelProvider } = require('../../src/integrations/threatIntel/MockThreatIntelProvider');
const { InMemoryThreatIntelCache } = require('../../src/integrations/threatIntel/ThreatIntelCacheRepository');

const svc = (extra = []) => new ThreatIntelService({
  providers: [new MockThreatIntelProvider(), ...extra],
  cache: new InMemoryThreatIntelCache(),
});

describe('ThreatIntelService (Mock-first)', () => {
  test('private IP → NICHT malicious (clean)', async () => {
    const r = await svc().enrich({ indicatorType: 'ip', indicatorValue: '192.168.241.102' });
    expect(r.ok).toBe(true);
    expect(r.result.verdict).toBe('clean');
    expect(r.result.tags).toContain('internal');
  });

  test('224.0.0.7 → multicast/local, NICHT malicious', async () => {
    const r = await svc().enrich({ indicatorType: 'ip', indicatorValue: '224.0.0.7' });
    expect(r.result.verdict).not.toBe('malicious');
    expect(r.result.verdict).toBe('clean');
    expect(r.result.tags).toEqual(expect.arrayContaining(['multicast', 'local-network-control']));
    expect(r.result.summary).toMatch(/multicast/i);
  });

  test('Demo-malicious IP → malicious', async () => {
    const r = await svc().enrich({ indicatorType: 'ip', indicatorValue: '185.220.101.12' });
    expect(r.result.verdict).toBe('malicious');
    expect(r.result.score).toBeGreaterThan(80);
  });

  test('nicht unterstützter indicatorType → ok:false', async () => {
    const r = await svc().enrich({ indicatorType: 'email', indicatorValue: 'x@y.z' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/indicatorType/);
  });

  test('ungültige IP → ok:false', async () => {
    const r = await svc().enrich({ indicatorType: 'ip', indicatorValue: '999.0.0.1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/IP/);
  });

  test('ungueltige Domain und URL werden vor Provider-Calls abgelehnt', async () => {
    await expect(svc().enrich({ indicatorType: 'domain', indicatorValue: 'not a domain' }))
      .resolves.toMatchObject({ ok: false });
    await expect(svc().enrich({ indicatorType: 'url', indicatorValue: 'javascript:alert(1)' }))
      .resolves.toMatchObject({ ok: false });
  });

  test('ueberlange Indicator-Werte werden begrenzt', async () => {
    const r = await svc().enrich({ indicatorType: 'url', indicatorValue: `https://example.test/${'a'.repeat(2050)}` });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/maximal/);
  });

  test('Provider-Fehler bricht den Service NICHT', async () => {
    const broken = { name: 'broken', isConfigured: () => true, enrich: async () => { throw new Error('boom'); } };
    const r = await svc([broken]).enrich({ indicatorType: 'ip', indicatorValue: '185.220.101.12' });
    expect(r.ok).toBe(true);
    expect(r.result.verdict).toBe('malicious'); // Mock liefert weiter
    expect(r.result.providers.find((p) => p.provider === 'broken').status).toBe('error');
  });

  test('Aggregation: schlechtester Verdict gewinnt', async () => {
    const susp = { name: 'susp', isConfigured: () => true, enrich: async () => ({ status: 'ok', verdict: 'suspicious', score: 50, confidence: 40, details: { tags: ['x'] } }) };
    // private IP (mock=clean) + suspicious-Provider → suspicious
    const r = await svc([susp]).enrich({ indicatorType: 'ip', indicatorValue: '10.0.0.5' });
    expect(r.result.verdict).toBe('suspicious');
  });

  test('normalisierte Struktur + source=mock', async () => {
    const r = await svc().enrich({ indicatorType: 'ip', indicatorValue: '8.8.8.8' });
    expect(r.result).toMatchObject({ indicatorType: 'ip', indicatorValue: '8.8.8.8', source: 'mock' });
    expect(Array.isArray(r.result.providers)).toBe(true);
    expect(typeof r.result.confidence).toBe('number');
  });

  test('Cache: zweiter Call liefert source=cache', async () => {
    const s = svc();
    await s.enrich({ indicatorType: 'ip', indicatorValue: '224.0.0.7' });
    const second = await s.enrich({ indicatorType: 'ip', indicatorValue: '224.0.0.7' });
    expect(second.result.source).toBe('cache');
  });

  test('not_configured-Provider blockiert die Aggregation nicht', async () => {
    const off = { name: 'virustotal', isConfigured: () => false, enrich: async () => ({}) };
    const r = await svc([off]).enrich({ indicatorType: 'ip', indicatorValue: '224.0.0.7' });
    expect(r.ok).toBe(true);
    expect(r.result.providers.find((p) => p.provider === 'virustotal').status).toBe('not_configured');
  });
});
