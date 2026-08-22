'use strict';

// ── ThreatIntel-Cache: InMemory-Verhalten + Factory-Toggle (Postgres bei DB_ENABLED) ──

const { InMemoryThreatIntelCache } = require('../../src/integrations/threatIntel/ThreatIntelCacheRepository');

describe('InMemoryThreatIntelCache', () => {
  test('set/get gibt den Wert innerhalb der TTL zurück', async () => {
    const cache = new InMemoryThreatIntelCache();
    await cache.set('ip:1.2.3.4', { verdict: 'malicious', score: 90 }, 60_000);
    expect(await cache.get('ip:1.2.3.4')).toEqual({ verdict: 'malicious', score: 90 });
  });

  test('get gibt null nach Ablauf der TTL', async () => {
    const cache = new InMemoryThreatIntelCache();
    await cache.set('ip:5.6.7.8', { verdict: 'clean' }, -1); // bereits abgelaufen
    expect(await cache.get('ip:5.6.7.8')).toBeNull();
  });

  test('get gibt null für unbekannten Key', async () => {
    const cache = new InMemoryThreatIntelCache();
    expect(await cache.get('ip:nope')).toBeNull();
  });
});

describe('createThreatIntelCache() — Factory-Toggle', () => {
  const ORIG_DB = process.env.DB_ENABLED;

  afterEach(() => {
    if (ORIG_DB === undefined) delete process.env.DB_ENABLED; else process.env.DB_ENABLED = ORIG_DB;
    jest.resetModules();
  });

  test('DB_ENABLED=false → InMemory', () => {
    delete process.env.DB_ENABLED;
    jest.resetModules();
    const { createThreatIntelCache } = require('../../src/integrations/threatIntel/threatIntelCacheFactory');
    const { InMemoryThreatIntelCache: InMem } = require('../../src/integrations/threatIntel/ThreatIntelCacheRepository');
    expect(createThreatIntelCache()).toBeInstanceOf(InMem);
  });

  test('DB_ENABLED=true → PostgresThreatIntelCache', () => {
    process.env.DB_ENABLED = 'true';
    jest.resetModules();
    const { createThreatIntelCache } = require('../../src/integrations/threatIntel/threatIntelCacheFactory');
    const { PostgresThreatIntelCache } = require('../../src/integrations/threatIntel/PostgresThreatIntelCache');
    expect(createThreatIntelCache()).toBeInstanceOf(PostgresThreatIntelCache);
  });
});
